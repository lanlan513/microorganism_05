// 服务端离线 WAV 渲染器（Node，零依赖）
//
// 与浏览器端 src/audio/SymphonyEngine.ts 使用同一套合成模型：
// 振荡器波形（sine/triangle/saw/square）+ 一阶低通（音色亮度）+
// 指数包络（致病性越高衰减越紧）+ 等功率声像 + 声部电平，
// 因此"在线试听"和"下载到的文件"在参数上严格一致，全部来自共享总谱。

import { midiToFreq } from './derive.js';
import type { SymphonyPlan, VoicePlan } from './symphony.js';

const SAMPLE_RATE = 48_000;
const MASTER_GAIN = 0.85;

/** 一阶 RC 低通（近似浏览器 BiquadFilter 'lowpass' 的听感） */
class OnePoleLowpass {
  private z = 0;
  private readonly coeff: number;
  constructor(cutoffHz: number) {
    const rc = 1 / (2 * Math.PI * Math.max(80, cutoffHz));
    const dt = 1 / SAMPLE_RATE;
    this.coeff = dt / (rc + dt);
  }
  process(x: number): number {
    this.z += this.coeff * (x - this.z);
    return this.z;
  }
}

function oscSample(waveform: VoicePlan['waveform'], phase: number): number {
  const p = phase - Math.floor(phase); // 0..1
  switch (waveform) {
    case 'sine':
      return Math.sin(2 * Math.PI * p);
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1;
    case 'sawtooth':
      return 2 * p - 1;
    case 'square':
      return p < 0.5 ? 1 : -1;
    default:
      return 0;
  }
}

interface ActiveNote {
  startSample: number;
  durationSamples: number;
  voice: VoicePlan;
  freq: number;
  gain: number;
  phase: number;
  filterL: OnePoleLowpass;
  filterR: OnePoleLowpass;
  panGainL: number;
  panGainR: number;
}

/** ADSR-ish 包络：快起音 + 指数衰减（致病性越高越紧）+ 末尾释放防咔哒声 */
function envelope(localSample: number, durationSamples: number, note: ActiveNote): number {
  const aSamples = Math.max(1, 0.008 * SAMPLE_RATE);
  let env: number;
  if (localSample < aSamples) {
    env = localSample / aSamples;
  } else {
    const decayTime = 1.4 - note.voice.tension * 1.05;
    env = Math.exp(-(localSample - aSamples) / (decayTime * SAMPLE_RATE));
  }
  const releaseSamples = 0.02 * SAMPLE_RATE;
  const remaining = note.startSample + note.durationSamples - (note.startSample + localSample);
  if (remaining < releaseSamples) env *= Math.max(0, remaining / releaseSamples);
  return env;
}

function pcmToWav(buffer: Float32Array): Buffer {
  const numChannels = 2;
  const blockAlign = numChannels * 2;
  const dataSize = buffer.length * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const pcm = Buffer.alloc(dataSize);
  for (let i = 0; i < buffer.length; i += 1) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return Buffer.concat([header, pcm]);
}

export interface RenderResult {
  wav: Buffer;
  durationSec: number;
}

/**
 * 渲染整份总谱。分块让出事件循环，任务队列借此更新进度、接收新任务。
 */
export async function renderPlanToWav(
  plan: SymphonyPlan,
  onProgress?: (progress: number) => void,
): Promise<RenderResult> {
  const durationSec = plan.loopDuration * plan.loops;
  const totalSamples = Math.ceil(durationSec * SAMPLE_RATE);
  const stereo = new Float32Array(totalSamples * 2);

  const voicesById = new Map(plan.voices.map((v) => [v.microbeId, v]));

  // 展开所有循环的音符
  const notes: ActiveNote[] = [];
  for (const microbeId of plan.order) {
    const voice = voicesById.get(microbeId);
    if (!voice) continue;
    for (let loop = 0; loop < plan.loops; loop += 1) {
      const loopOffset = loop * plan.loopDuration;
      for (const ev of plan.events[microbeId] ?? []) {
        const startSample = Math.floor((loopOffset + ev.time) * SAMPLE_RATE);
        const durationSamples = Math.max(1, Math.floor(ev.duration * SAMPLE_RATE));
        ev.midi.forEach((midi, idx) => {
          const gainScale = idx === 0 ? 1 : 0.6; // 和弦叠音稍弱
          notes.push({
            startSample,
            durationSamples,
            voice,
            freq: midiToFreq(midi),
            gain: ev.velocity * voice.level * MASTER_GAIN * gainScale,
            // 相位按起始采样自然错开，避免多声部完全同相叠加
            phase: ((startSample * midiToFreq(midi)) / SAMPLE_RATE) % 1,
            filterL: new OnePoleLowpass(voice.cutoffHz),
            filterR: new OnePoleLowpass(voice.cutoffHz),
            panGainL: Math.cos(voice.pan * Math.PI * 0.5),
            panGainR: Math.sin(voice.pan * Math.PI * 0.5),
          });
        });
      }
    }
  }
  notes.sort((a, b) => a.startSample - b.startSample);

  let cursor = 0;
  const CHUNK = Math.floor(SAMPLE_RATE * 0.1);
  for (let from = 0; from < totalSamples; from += CHUNK) {
    const to = Math.min(totalSamples, from + CHUNK);

    // 推进到当前块内仍可能发声的音符
    while (cursor < notes.length && notes[cursor].startSample + notes[cursor].durationSamples <= from) {
      cursor += 1;
    }

    for (let s = from; s < to; s += 1) {
      let l = 0;
      let r = 0;
      for (let i = cursor; i < notes.length; i += 1) {
        const note = notes[i];
        if (note.startSample > s) break;
        if (note.startSample + note.durationSamples <= s) continue;

        const local = s - note.startSample;
        const raw = oscSample(note.voice.waveform, note.phase);
        note.phase += note.freq / SAMPLE_RATE;
        if (note.phase >= 1) note.phase -= 1;

        const env = envelope(local, note.durationSamples, note) * note.gain;
        const v = raw * env;
        l += note.filterL.process(v) * note.panGainL;
        r += note.filterR.process(v) * note.panGainR;
      }
      const out = s * 2;
      // tanh 软限幅，与浏览器端 DynamicsCompressor 之前的总线处理保持一致
      stereo[out] = Math.tanh(l);
      stereo[out + 1] = Math.tanh(r);
    }

    onProgress?.(Math.min(0.99, 0.05 + (to / totalSamples) * 0.93));
    // 让出事件循环：队列可更新进度，HTTP 请求不会被饿死
    await new Promise((resolve) => setImmediate(resolve));
  }

  onProgress?.(1);
  return { wav: pcmToWav(stereo), durationSec };
}
