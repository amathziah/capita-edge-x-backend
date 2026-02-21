import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as systemController from '../controllers/systemController.js';

const router = express.Router();

router.get('/db-volume', asyncHandler(systemController.getDbVolume));
router.post('/stress-test', asyncHandler(systemController.runStressTest));

export default router;
