import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as systemController from '../controllers/systemController.js';

const router = express.Router();

// router.post('/run-catalog-stress', asyncHandler(systemController.runCatalogStressTest));

export default router;
