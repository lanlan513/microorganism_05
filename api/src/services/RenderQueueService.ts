import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TRANSPORT, midiToFreq } from './AudioParamService.js';
import type { AudioParams, RenderJobStatus, RenderJobView, SymphonyVoice } from '../../../shared/types.js';

/**
 * 下载任务队列：渲染在服务端排队进行，浏览器只负责提交与轮询。
 * 渲染器与浏览器引擎使用同一份服务端推导参数：
 * 锯齿波 → 单极点低通（亮度=截止频率）→ 包络，叠加和声音程。
 */

const SAMPLE_RATE = 44100;
const JOB_TTL_MS = 60 * 60 * 1000; // 任务与文件保留 1 小时

// Vercel serverless 只有 /tmp 可写；本地开发写到项目 data/ 下
const RENDERS_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'microsymphony-renders')
  : path.join(process.cwd(), 'data', 'renders');
fs.mkdirSync(RENDERS_DIR, { recursive: true });

interface RenderJob {
  id: string;
  status: RenderJobStatus;
  voices: SymphonyVoice[] | null;
  file: string | null;
  error: string | null;
  createdAt: number;
}

const jobs = new Map<string, RenderJob>();
const queue: string[] = [];
let processing = false;

/* ---------------- WAV 渲染 ---------------- */

function renderComposition(voices: SymphonyVoice[]): Buffer {
  const stepDur = 60 / TRANSPORT.bpm / 4;
  const tail = 1.5; // 末尾留尾音
  const totalSeconds = TRANSPORT.bars * TRANSPORT.stepsPerBar * stepDur + tail;
  const mix = new Float32Array(Math.ceil(totalSeconds * SAMPLE_RATE));

  for (const voice of voices) {
    const p = voice.audio;
    for (let bar = 0; bar < TRANSPORT.bars; bar++) {
      for (let s = 0; s < TRANSPORT.stepsPerBar; s++) {
        if (!p.rhythm.steps[s]) continue;
        renderNote(mix, (bar * TRANSPORT.stepsPerBar + s) * stepDur, p);
      }
    }
  }

  for (let i = 0; i < mix.length; i++) {
    mix[i] = Math.tanh(mix[i] * 0.8); // 软限幅，防止叠加爆音
  }
  return encodeWav(mix);
}

function renderNote(mix: Float32Array, t0: number, p: AudioParams): void {
  const start = Math.floor(t0 * SAMPLE_RATE);
  const len = Math.min(mix.length - start, Math.ceil((p.decaySeconds + 0.1) * SAMPLE_RATE));
  if (len <= 0) return;

  const intervals = p.harmony.intervals;
  const amp = 0.55 / intervals.length;
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(p.cutoffHz, 12000)) / SAMPLE_RATE);

  for (const interval of intervals) {
    const freq =
      midiToFreq(p.midi + interval) *
      Math.pow(2, (interval === 0 ? 0 : p.harmony.detuneCents) / 1200);
    const dphi = freq / SAMPLE_RATE;
    let phase = 0;
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, t / 0.006) * Math.exp(-t / p.decaySeconds);
      phase += dphi;
      if (phase >= 1) phase -= 1;
      y += a * (2 * phase - 1 - y); // 锯齿波 → 单极点低通
      mix[start + i] += y * env * amp;
    }
  }
}

function encodeWav(samples: Float32Array): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM 块大小
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); // 16bit
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* ---------------- 队列 ---------------- */

function pump(): void {
  if (processing) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job) {
    pump();
    return;
  }
  processing = true;
  job.status = 'processing';
  setImmediate(() => {
    try {
      const wav = renderComposition(job.voices ?? []);
      job.file = path.join(RENDERS_DIR, `${job.id}.wav`);
      fs.writeFileSync(job.file, wav);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    } finally {
      job.voices = null; // 释放参数快照
      processing = false;
      pump();
    }
  });
}

export function enqueueRender(voices: SymphonyVoice[]): RenderJob {
  const job: RenderJob = {
    id: crypto.randomBytes(6).toString('base64url'),
    status: 'queued',
    voices,
    file: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  setImmediate(pump);
  return job;
}

export function getJobView(id: string): RenderJobView | null {
  const job = jobs.get(id);
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    position: job.status === 'queued' ? queue.indexOf(job.id) + 1 : 0,
    fileUrl: job.status === 'done' ? `/api/symphony/renders/${job.id}/file` : undefined,
    error: job.status === 'failed' ? (job.error ?? '渲染失败') : undefined,
  };
}

export function getJobFile(id: string): string | null {
  const job = jobs.get(id);
  return job && job.status === 'done' ? job.file : null;
}

// 定期清理过期任务与 WAV 文件
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'processing' && now - job.createdAt > JOB_TTL_MS) {
      if (job.file) fs.unlink(job.file, () => {});
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();
