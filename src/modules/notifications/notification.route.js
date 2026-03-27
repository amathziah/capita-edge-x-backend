import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as notificationController from './notification.controller.js';

const router = express.Router();

// Mount at /api/notifications
router.get('/', asyncHandler(notificationController.getNotifications));

export default router;
