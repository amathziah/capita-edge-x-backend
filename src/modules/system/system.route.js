import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as systemController from './system.controller.js';

const router = express.Router();

// router.post('/run-catalog-stress', asyncHandler(systemController.runCatalogStressTest));

export default router;
