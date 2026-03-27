import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId } from '../../core/middleware/validation.js';
import * as complianceController from './compliance.controller.js';

const router = express.Router();

// Mount at /api/compliance
router.get('/', asyncHandler(complianceController.getTasks));
router.post('/', asyncHandler(complianceController.createTask));
router.put('/:id', validateId, asyncHandler(complianceController.updateTask));
router.delete('/:id', validateId, asyncHandler(complianceController.deleteTask));

export default router;
