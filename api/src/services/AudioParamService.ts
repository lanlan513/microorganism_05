import microbesData from '../data/microbesData.json' with { type: 'json' };
import microbesBioData from '../data/microbesBio.json' with { type: 'json' };
import type {
  AudioParams,
  Metabolism,
  Microbe,
  MicrobeBio,
  SymphonyTransport,
  SymphonyVoice,
} from '../../../shared/types.js';

/**
 * 微观交响 · 参数推导服务（全馆唯一权威）
 *
 * 所有映射都是纯函数：输入只依赖标本 id 与策展数据，
 * 哈希与随机数全部用整数运算（Math.imul），
 * 保证同一标本在任何设备、任何时刻推导出同一套数值。
 */

/** 客户端与服务端渲染共用的走带参数 */
export const TRANSPORT: SymphonyTransport = { bpm: 96, stepsPerBar: 16, bars: 4 };

/** 一段交响最多叠加的标本数 */
export const MAX_LAYERS = 6;

const microbes = microbesData as Microbe[];
const bios = microbesBioData as MicrobeBio[];
const bioById = new Map(bios.map((b) => [b.id, b]));

/* ---------------- 确定性工具 ---------------- */

/** FNV-1a 哈希：纯整数运算，跨平台结果一致 */
function hashId(id: number): number {
  let h = 2166136261 >>> 0;
  const s = `microbe:${id}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 伪随机：同一种子同一序列 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------------- 映射规则 ---------------- */

// 大小 → 音高：对数映射，越大越低（0.05µm ~ 200000µm → C6 ~ C2）
const SIZE_MIN_UM = 0.05;
const SIZE_MAX_UM = 200000;
const MIDI_HIGH = 84; // C6
const MIDI_LOW = 36; // C2

function sizeToMidi(sizeUm: number): number {
  const t = clamp(
    (Math.log10(sizeUm) - Math.log10(SIZE_MIN_UM)) / (Math.log10(SIZE_MAX_UM) - Math.log10(SIZE_MIN_UM)),
    0,
    1,
  );
  return Math.round(lerp(MIDI_HIGH, MIDI_LOW, t));
}

// 最适温度 → 音色亮度：15~105°C → 0..1 → 低通截止 180Hz ~ 8.1kHz
function tempToBrightness(tempC: number): number {
  return clamp((tempC - 15) / 90, 0, 1);
}

// 代谢方式 → 节奏密度（16 步中的触发数）
const RHYTHM_DENSITY: Record<Metabolism, number> = {
  aerobic: 8, // 需氧：代谢旺盛，节奏密集
  facultative: 5, // 兼性：中等
  anaerobic: 3, // 厌氧：代谢缓慢，节奏稀疏
  parasitic: 5, // 专性寄生：劫持宿主节拍 → 反拍切分
};

// 拍位优先级（强 → 弱）；寄生者反拍优先，且不占第 0 步强拍
const BEAT_STRENGTH = [8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];
const OFFBEAT_FIRST = [1, 3, 5, 7, 9, 11, 13, 15, 2, 6, 10, 14, 4, 8, 12];

function buildRhythm(metabolism: Metabolism, id: number): { steps: boolean[]; density: number } {
  const density = RHYTHM_DENSITY[metabolism];
  const rand = mulberry32(hashId(id));
  const steps = new Array<boolean>(TRANSPORT.stepsPerBar).fill(false);
  const order = metabolism === 'parasitic' ? OFFBEAT_FIRST : BEAT_STRENGTH;
  let placed = 0;
  if (metabolism !== 'parasitic') {
    steps[0] = true; // 保留共同强拍，多条叠加时仍有统一脉搏
    placed = 1;
  }
  for (const pos of order) {
    if (placed >= density) break;
    if (rand() < 0.85) {
      steps[pos] = true;
      placed++;
    }
  }
  for (const pos of order) {
    if (placed >= density) break;
    if (!steps[pos]) {
      steps[pos] = true;
      placed++;
    }
  }
  return { steps, density };
}

// 致病性 → 和声紧张度
const HARMONY_TABLE: Array<{ intervals: number[]; detuneCents: number; label: string }> = [
  { intervals: [0], detuneCents: 0, label: '协和 · 纯音' },
  { intervals: [0, 7], detuneCents: 0, label: '温和 · 纯五度' },
  { intervals: [0, 3, 7], detuneCents: 4, label: '紧张 · 小三和弦' },
  { intervals: [0, 6, 13], detuneCents: 9, label: '尖锐 · 三全音与小九度' },
];

// 代谢 → 余音长度（稀疏的节奏配更长的尾音）
const DECAY_SECONDS: Record<Metabolism, number> = {
  aerobic: 0.18,
  facultative: 0.4,
  anaerobic: 0.9,
  parasitic: 0.3,
};

/* ---------------- 对外接口 ---------------- */

export function deriveAudioParams(bio: MicrobeBio): AudioParams {
  const brightness = tempToBrightness(bio.tempC);
  return {
    midi: sizeToMidi(bio.sizeUm),
    brightness: Math.round(brightness * 1000) / 1000,
    cutoffHz: Math.round(180 * Math.pow(2, brightness * 5.5)),
    rhythm: buildRhythm(bio.metabolism, bio.id),
    harmony: HARMONY_TABLE[clamp(bio.pathogenicity, 0, 3)],
    decaySeconds: DECAY_SECONDS[bio.metabolism],
  };
}

export function getSymphonyVoice(id: number): SymphonyVoice | undefined {
  const microbe = microbes.find((m) => m.id === id);
  const bio = bioById.get(id);
  if (!microbe || !bio) return undefined;
  return { microbe, bio, audio: deriveAudioParams(bio) };
}

export function getAllVoiceIds(): number[] {
  return microbes.map((m) => m.id);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
