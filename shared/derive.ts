// 微观交响 · 参数推导引擎（唯一真源）
//
// 设计原则：
// 1. 所有声音数值只在这里推导一次，由服务端通过 API 下发；浏览器只负责"照谱演奏"，
//    因此同一条标本在任何设备、任何时间听到的都是同一套数值，分享后别人听到的也完全一致。
// 2. 全部为纯函数 + 确定性 PRNG，不依赖 Node 或 DOM，服务端 WAV 离线渲染也复用本文件。
// 3. 修改任何映射规则都必须升 SCHEMA_VERSION，旧分享链接会自动按新版本重新推导。

import type {
  Pathogenicity,
  SonificationTraits,
  SymphonyNoteEvent,
  SymphonyPlan,
  VoicePlan,
} from './symphony.js';

export const SCHEMA_VERSION = 1;
export const BPM = 84;
export const STEPS = 32; // 两个小节的十六分步
export const LOOPS = 4; // 离线下载渲染的循环遍数
export const MAX_VOICES = 6;

const STEP_DURATION = 60 / BPM / 4; // 单个十六分步的秒数
export const LOOP_DURATION = STEP_DURATION * STEPS;

// ---------------------------------------------------------------------------
// 确定性随机：mulberry32。种子 = 标本 id × 版本，同一条标本永远抽出同一串"节奏与旋律"。
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 音高工具
// ---------------------------------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToNoteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// 调式音阶（相对根音的半音偏移）—— 致病性决定用哪个调式
const SCALES: Record<Pathogenicity, { name: string; semis: number[]; chord: number[] }> = {
  0: { name: '大调五声音阶（纯净和声）', semis: [0, 2, 4, 7, 9], chord: [7] },
  1: { name: '自然大调（协和三和弦）', semis: [0, 2, 4, 5, 7, 9, 11], chord: [4, 7] },
  2: { name: '自然小调（暗色三和弦）', semis: [0, 2, 3, 5, 7, 8, 10], chord: [3, 7, 6] },
  3: { name: '和声小调·半减七和弦（高度紧张）', semis: [0, 2, 3, 5, 7, 8, 11], chord: [3, 6, 10] },
};

// ---------------------------------------------------------------------------
// 单条标本 → 声部参数
// ---------------------------------------------------------------------------
export function deriveVoice(traits: SonificationTraits): VoicePlan {
  const seed = (traits.sizeUm * 1000 + traits.tempC * 7 + traits.pathogenicity * 131
    + (traits.metabolism === 'aerobic' ? 17 : traits.metabolism === 'anaerobic' ? 29 : 43))
    >>> 0;
  const rng = mulberry32(seed);

  // ① 大小 → 音高。体长跨 7 个数量级（病毒 0.09μm ~ 蘑菇 90000μm），
  //    取对数后线性映射到 MIDI 24~96：越小越高、越大越低。
  const SIZE_MIN = 0.08;
  const SIZE_MAX = 100_000;
  const tSize = clamp(
    (Math.log10(traits.sizeUm) - Math.log10(SIZE_MIN))
      / (Math.log10(SIZE_MAX) - Math.log10(SIZE_MIN)),
    0, 1,
  );
  const baseMidi = Math.round(clamp(96 - tSize * 72, 24, 96));

  // ② 喜温 → 音色亮度。-5°C ~ 105°C 归一；波形与低通截止都由亮度决定。
  const brightness = clamp((traits.tempC + 5) / 110, 0, 1);
  let waveform: VoicePlan['waveform'];
  let tempPreference: VoicePlan['tempPreference'];
  if (traits.tempC < 15) {
    waveform = 'sine'; // 嗜冷：最圆润
    tempPreference = 'psychrophile';
  } else if (traits.tempC < 45) {
    waveform = 'triangle'; // 常温：温润
    tempPreference = 'mesophile';
  } else if (traits.tempC < 80) {
    waveform = 'sawtooth'; // 嗜热：明亮粗糙
    tempPreference = 'thermophile';
  } else {
    waveform = 'square'; // 超嗜热：尖锐、泛音拉满
    tempPreference = 'thermophile';
  }
  const cutoffHz = Math.round(500 + brightness * 7_500);

  // ③ 代谢 → 节奏疏密。
  //    厌氧：长呼吸、稀疏；需氧：短促、绵密；兼性：居中。
  let density: number;
  let stepBreath: number;
  let noteBeats: number;
  if (traits.metabolism === 'anaerobic') {
    density = 0.55;
    stepBreath = 0.3;
    noteBeats = 2;
  } else if (traits.metabolism === 'aerobic') {
    density = 0.6;
    stepBreath = 0.08;
    noteBeats = 0.5;
  } else {
    density = 0.42;
    stepBreath = 0.2;
    noteBeats = 1;
  }

  // ④ 致病性 → 和声紧张度。
  const tension = traits.pathogenicity / 3;
  const scale = SCALES[traits.pathogenicity];
  // 等级 2 的三全音只在部分重拍出现，制造"间歇性不安"
  const chordIntervals = scale.chord.filter((interval) => {
    if (interval === 6 && traits.pathogenicity === 2) return false;
    return true;
  });

  const pan = Math.round((0.15 + rng() * 0.7) * 100) / 100;
  const degrees = Array.from({ length: 8 }, () => Math.floor(rng() * scale.semis.length));

  return {
    microbeId: 0, // 由组装方回填
    category: '', // 由组装方回填（仅可视化取色，不参与推导）
    seed,
    baseMidi,
    noteName: midiToNoteName(baseMidi),
    baseFreq: Math.round(midiToFreq(baseMidi) * 100) / 100,
    degrees,
    brightness: Math.round(brightness * 100) / 100,
    tempPreference,
    waveform,
    cutoffHz,
    density,
    stepBreath,
    metabolism: traits.metabolism,
    noteBeats,
    pathogenicity: traits.pathogenicity,
    tension: Math.round(tension * 100) / 100,
    chordIntervals,
    scaleMode: scale.name,
    pan,
    level: 0.85,
  };
}

// ---------------------------------------------------------------------------
// 声部 → 一个循环内的确定性音符序列（服务端预算好，客户端只做调度）
// ---------------------------------------------------------------------------
export function buildEvents(voice: VoicePlan): SymphonyNoteEvent[] {
  const rng = mulberry32(voice.seed ^ 0x9e3779b9);
  const scale = SCALES[voice.pathogenicity].semis;
  const events: SymphonyNoteEvent[] = [];

  const grid = voice.metabolism === 'anaerobic' ? 2 : 1;
  let degree = Math.floor(rng() * scale.length);
  const skipUntil = new Array(STEPS).fill(false);

  for (let step = 0; step < STEPS; step += 1) {
    if (step % grid !== 0 || skipUntil[step]) continue;

    // 密度门 + 呼吸留白（厌氧留白最多）
    if (rng() >= voice.density || rng() < voice.stepBreath) continue;

    // 旋律在调式内随机游走 ±2 度
    degree = clamp(degree + Math.floor(rng() * 5) - 2, 0, scale.length - 1);
    const midi = voice.baseMidi + scale[degree];

    const downbeat = step % 8 === 0;
    const midiNotes = [midi];
    if (downbeat) {
      for (const interval of voice.chordIntervals) {
        // 等级 2：三全音以 40% 概率突袭；其余音程全部叠加
        if (interval === 6 && voice.pathogenicity === 2 && rng() > 0.4) continue;
        if (!midiNotes.includes(midi + interval)) midiNotes.push(midi + interval);
      }
      midiNotes.sort((a, b) => a - b);
    }

    const duration = voice.noteBeats * STEP_DURATION * 4 * 0.92;
    events.push({
      time: Math.round(step * STEP_DURATION * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      midi: midiNotes,
      velocity: Math.round((downbeat ? 1 : 0.72 + rng() * 0.22) * 100) / 100,
      downbeat,
    });

    // 长音持续期间跳过被覆盖的候选步
    const occupy = Math.max(1, Math.round(voice.noteBeats * 4));
    for (let s = step + 1; s < Math.min(STEPS, step + occupy); s += 1) skipUntil[s] = true;
  }

  return events;
}

// ---------------------------------------------------------------------------
// 多条标本 → 一份总谱
// ---------------------------------------------------------------------------
export function buildSymphony(
  items: { id: number; category?: string; traits: SonificationTraits }[],
): SymphonyPlan {
  const voices: VoicePlan[] = [];
  const events: Record<number, SymphonyNoteEvent[]> = {};
  const order: number[] = [];

  // 声部越多每个声部越轻，防止叠奏削波；同一电平对所有人生效
  const level = Math.round(clamp(0.9 / Math.sqrt(items.length), 0.16, 0.85) * 100) / 100;

  for (const item of items) {
    const voice = deriveVoice(item.traits);
    voice.microbeId = item.id;
    voice.category = item.category ?? '';
    voice.level = level;
    voices.push(voice);
    events[item.id] = buildEvents(voice);
    order.push(item.id);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    bpm: BPM,
    steps: STEPS,
    loopDuration: LOOP_DURATION,
    loops: LOOPS,
    voices,
    events,
    order,
  };
}
