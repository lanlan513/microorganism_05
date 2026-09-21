import type { Request, Response } from 'express';
import { SymphonyService, InvalidSelectionError } from '../services/SymphonyService.js';
import { RenderQueue, fileReady } from '../services/RenderQueue.js';
import type { Microbe } from '../../../shared/types.js';

// 给前端的标本元数据（不带描述长文，只带演奏/展示需要的字段）
function voiceMeta(m: Microbe) {
  return {
    id: m.id,
    name: m.name,
    scientificName: m.scientificName,
    category: m.category,
    imageUrl: m.imageUrl,
    size: m.size,
    sizeUm: m.sizeUm,
    tempC: m.tempC,
    metabolism: m.metabolism,
    pathogenicity: m.pathogenicity,
    pathogenicityNote: m.pathogenicityNote,
  };
}

export class SymphonyController {
  /** POST /api/symphony/plan { ids: number[] } —— 按选择推导总谱并返回分享 token */
  static createPlan(req: Request, res: Response) {
    try {
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((v: unknown) => Number(v))
        : [];
      const { plan, microbes } = SymphonyService.buildPlan(ids);
      const token = SymphonyService.encodeToken(plan.order);
      res.json({
        success: true,
        data: {
          token,
          shareUrl: `/symphony/${token}`,
          plan,
          microbes: microbes.map(voiceMeta),
        },
      });
    } catch (err) {
      SymphonyController.handleError(err, res);
    }
  }

  /** GET /api/symphony/plan/:token —— 分享链接打开时由服务端重新推导同一份总谱 */
  static getPlanByToken(req: Request, res: Response) {
    try {
      const ids = SymphonyService.decodeToken(req.params.token);
      const { plan, microbes } = SymphonyService.buildPlan(ids);
      res.json({
        success: true,
        data: {
          token: req.params.token,
          shareUrl: `/symphony/${req.params.token}`,
          plan,
          microbes: microbes.map(voiceMeta),
        },
      });
    } catch (err) {
      SymphonyController.handleError(err, res);
    }
  }

  /** POST /api/symphony/render { token } —— 排队生成 WAV */
  static enqueueRender(req: Request, res: Response) {
    try {
      const token = String(req.body?.token ?? '');
      const ids = SymphonyService.decodeToken(token);
      const { plan } = SymphonyService.buildPlan(ids);
      const job = RenderQueue.enqueue(plan, token);
      res.status(202).json({ success: true, data: job });
    } catch (err) {
      SymphonyController.handleError(err, res);
    }
  }

  /** GET /api/symphony/render/:id?token=... —— 轮询任务状态 */
  static getRender(req: Request, res: Response) {
    const job = RenderQueue.get(req.params.id);
    if (!job) {
      res.status(404).json({ success: false, error: '任务不存在或已过期' });
      return;
    }
    const token = String(req.query.token ?? '');
    if (job.token !== token) {
      res.status(403).json({ success: false, error: '无权访问该任务' });
      return;
    }
    res.json({ success: true, data: job });
  }

  /** GET /api/symphony/render/:id/download?token=... —— 下载 WAV */
  static async download(req: Request, res: Response) {
    try {
      const token = String(req.query.token ?? '');
      const hit = RenderQueue.getFileForDownload(req.params.id, token);
      if (!hit || !(await fileReady(hit.filePath))) {
        res.status(404).json({ success: false, error: '文件尚未就绪或任务已过期' });
        return;
      }
      res.download(hit.filePath, hit.file, {
        headers: { 'Content-Type': 'audio/wav' },
      });
    } catch (err) {
      SymphonyController.handleError(err, res);
    }
  }

  static handleError(err: unknown, res: Response) {
    if (err instanceof InvalidSelectionError) {
      res.status(err.status).json({ success: false, error: err.message });
      return;
    }
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : '服务异常';
    res.status(status).json({ success: false, error: message });
  }
}
