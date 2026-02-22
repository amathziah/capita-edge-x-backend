import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as planController from '../controllers/planController.js';

const router = express.Router();

router.get('/status', asyncHandler(planController.getPlanStatus));

export default router;
