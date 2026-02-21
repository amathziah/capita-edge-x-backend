import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as systemController from '../controllers/systemController.js';

const router = express.Router();

export default router;
