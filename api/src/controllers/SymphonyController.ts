import type { Request, Response } from 'express';
import {
  getAllVoiceIds,
  getSymphonyVoice,
  MAX_LAYERS,
  TRANSPORT,
} from '../services/AudioParamService.js';
import { enqueueRender, getJobFile, getJobView } from '../services/RenderQueueService.js';
import type { SymphonyVoice } from '../../../shared/types.js';

function resolveVoices(ids: number[]): SymphonyVoice[] | null {
  const voices = ids.map((id) => getSymphonyVoice(id));
  return voices.every(Boolean) ? (voices as SymphonyVoice[]) : null;
}

export class SymphonyController {
  /**
   * GET /api/symphony/params?ids=1,2,3
   * 可听化参数的唯一来源；不带 ids 返回全馆声部。
   */
  static getParams(req: Request, res: Response) {
    try {
      const raw =
        typeof req.query.ids === 'string' && req.query.ids.trim() !== ''
          ? req.query.ids.split(',').map((s) => Number(s.trim()))
          : getAllVoiceIds();
      const ids = [...new Set(raw)].filter((n) => Number.isInteger(n) && n > 0);
      const voices = ids
        .map((id) => getSymphonyVoice(id))
        .filter((v): v is SymphonyVoice => Boolean(v));
      res.json({ success: true, data: { transport: TRANSPORT, voices } });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  /**
   * POST /api/symphony/renders  { ids: number[] }
   * 下载任务排队，服务端生成 WAV；返回 202 与轮询地址。
   */
  static createRender(req: Request, res: Response) {
    try {
      const raw: unknown = req.body?.ids;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ success: false, error: 'ids 需为标本 id 数组' });
      }
      const ids = [...new Set(raw.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length < 1 || ids.length > MAX_LAYERS) {
        return res
          .status(400)
          .json({ success: false, error: `一段交响需 1~${MAX_LAYERS} 条标本` });
      }
      const voices = resolveVoices(ids);
      if (!voices) {
        return res.status(404).json({ success: false, error: '包含不存在的标本 id' });
      }
      const job = enqueueRender(voices);
      res.status(202).json({
        success: true,
        data: { jobId: job.id, statusUrl: `/api/symphony/renders/${job.id}` },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }

  /** GET /api/symphony/renders/:jobId —— 任务状态（含排队位置） */
  static getRender(req: Request, res: Response) {
    const view = getJobView(req.params.jobId);
    if (!view) {
      return res.status(404).json({ success: false, error: '任务不存在或已过期' });
    }
    res.json({ success: true, data: view });
  }

  /** GET /api/symphony/renders/:jobId/file —— 渲染完成后下载 WAV */
  static getRenderFile(req: Request, res: Response) {
    const view = getJobView(req.params.jobId);
    if (!view) {
      return res.status(404).json({ success: false, error: '任务不存在或已过期' });
    }
    if (view.status !== 'done') {
      return res.status(409).json({ success: false, error: '渲染尚未完成', data: view });
    }
    const file = getJobFile(req.params.jobId);
    if (!file) {
      return res.status(404).json({ success: false, error: '文件不存在或已过期' });
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="microsymphony-${view.id}.wav"`,
    );
    res.sendFile(file);
  }
}
