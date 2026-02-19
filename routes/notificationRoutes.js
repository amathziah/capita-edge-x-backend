import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as notificationController from '../controllers/notificationController.js';

const router = express.Router();

// Mount at /api/notifications
router.get('/', asyncHandler(notificationController.getNotifications));

export default router;
