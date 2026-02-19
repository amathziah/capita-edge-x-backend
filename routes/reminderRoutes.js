import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as reminderController from '../controllers/reminderController.js';

const router = express.Router();

// Routes
router.get('/', asyncHandler(reminderController.getReminders));
router.post('/', asyncHandler(reminderController.createReminder));
router.delete('/:id', asyncHandler(reminderController.deleteReminder));

export default router;
