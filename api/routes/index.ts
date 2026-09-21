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

// 微观交响：参数推导（服务端权威）与下载任务队列
router.get('/symphony/params', SymphonyController.getParams);
router.post('/symphony/renders', SymphonyController.createRender);
router.get('/symphony/renders/:jobId', SymphonyController.getRender);
router.get('/symphony/renders/:jobId/file', SymphonyController.getRenderFile);

export default router;
