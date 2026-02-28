import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as planController from '../controllers/planController.js';

const router = express.Router();

router.get('/status', asyncHandler(planController.getPlanStatus));
router.get('/tiers', asyncHandler(planController.getAllTiers));

export default router;
