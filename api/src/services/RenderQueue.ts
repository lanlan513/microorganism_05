// 下载任务队列：服务端串行离线渲染 WAV，浏览器只轮询状态、最后拿文件。
// 文件落在系统临时目录，任务与文件 1 小时后自动清理。

import { randomBytes } from 'node:crypto';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderPlanToWav } from '../../../shared/renderWav.js';
import { writeFile } from 'node:fs/promises';
import type { RenderJob, SymphonyPlan } from '../../../shared/symphony.js';

const JOBS_DIR = path.join(os.tmpdir(), 'microbe-symphony-jobs');
const TTL_MS = 60 * 60 * 1000;
const MAX_QUEUE = 20;

interface InternalJob extends RenderJob {
  filePath: string;
  plan: SymphonyPlan;
}

const jobs = new Map<string, InternalJob>();
let running = false;

async function ensureDir() {
  if (!existsSync(JOBS_DIR)) {
    await mkdir(JOBS_DIR, { recursive: true });
  }
}

function fileNameFor(token: string, plan: SymphonyPlan): string {
  return `symphony-v${plan.schemaVersion}-${token.slice(0, 16)}.wav`;
}

async function pump() {
  if (running) return;
  running = true;
  try {
    // 串行渲染：一个 Node 进程一次只做一份总谱，避免多任务把 CPU 打满
    for (const job of jobs.values()) {
      if (job.status !== 'queued') continue;
      job.status = 'rendering';
      try {
        const { wav } = await renderPlanToWav(job.plan, (p) => {
          job.progress = Math.round(p * 100) / 100;
        });
        await ensureDir();
        await writeFile(job.filePath, wav);
        job.status = 'done';
        job.progress = 1;
        job.size = wav.length;
        job.file = fileNameFor(job.token, job.plan);
      } catch (err) {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : '渲染失败';
      }
    }
  } finally {
    running = false;
  }
}

/** 惰性清理过期任务与文件 */
function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) {
      jobs.delete(id);
      void unlink(job.filePath).catch(() => {});
    }
  }
}

export const RenderQueue = {
  enqueue(plan: SymphonyPlan, token: string): RenderJob {
    sweep();
    if ([...jobs.values()].filter((j) => j.status === 'queued').length >= MAX_QUEUE) {
      throw Object.assign(new Error('排队任务已满，请稍后再试'), { status: 503 });
    }
    const id = randomBytes(8).toString('hex');
    const file = fileNameFor(token, plan);
    const job: InternalJob = {
      id,
      token,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      filePath: path.join(JOBS_DIR, `${id}-${file}`),
      plan,
    };
    jobs.set(id, job);
    void pump();
    return publicView(job);
  },

  get(id: string): RenderJob | undefined {
    const job = jobs.get(id);
    return job ? publicView(job) : undefined;
  },

  /** 下载校验：任务必须完成、且 token 必须与创建时一致 */
  getFileForDownload(id: string, token: string): { filePath: string; file: string } | undefined {
    const job = jobs.get(id);
    if (!job || job.status !== 'done' || job.token !== token) return undefined;
    return { filePath: job.filePath, file: job.file ?? fileNameFor(token, job.plan) };
  },

  // 测试/健康检查用
  pendingCount() {
    return [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'rendering').length;
  },
};

function publicView(job: InternalJob): RenderJob {
  return {
    id: job.id,
    token: job.token,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    error: job.error,
    file: job.file,
    size: job.size,
  };
}

// 暴露文件大小检查给下载路由使用（防止文件已被外部删除）
export async function fileReady(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile() && s.size > 44;
  } catch {
    return false;
  }
}
