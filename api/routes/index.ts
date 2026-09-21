import { Router } from 'express';
import { MicrobeController } from '../src/controllers/MicrobeController.js';
import { SymphonyController } from '../src/controllers/SymphonyController.js';

const router = Router();

router.get('/microbes', MicrobeController.getAll);
router.get('/microbes/stats', MicrobeController.getStats);
router.get('/microbes/category/:category', MicrobeController.getByCategory);
router.get('/microbes/:id', MicrobeController.getById);
router.get('/microbes/:id/related', MicrobeController.getRelated);
router.get('/stats', MicrobeController.getStats);

// 微观交响：总谱推导 / 分享 token / 服务端排队下载
router.post('/symphony/plan', SymphonyController.createPlan);
router.get('/symphony/plan/:token', SymphonyController.getPlanByToken);
router.post('/symphony/render', SymphonyController.enqueueRender);
router.get('/symphony/render/:id', SymphonyController.getRender);
router.get('/symphony/render/:id/download', SymphonyController.download);

export default router;
