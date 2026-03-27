import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validatePayment } from '../../core/middleware/validation.js';
import * as paymentController from './payment.controller.js';

const router = express.Router();

router.get('/', asyncHandler(paymentController.getPayments));
router.post('/', validatePayment, asyncHandler(paymentController.createPayment));
router.patch('/:id/reconcile', asyncHandler(paymentController.reconcilePayment));
router.get('/download-receipt/:paymentId', asyncHandler(paymentController.downloadReceipt));

export default router;
