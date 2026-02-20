import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validatePayment } from '../middleware/validation.js';
import * as paymentController from '../controllers/paymentController.js';

const router = express.Router();

router.get('/', asyncHandler(paymentController.getPayments));
router.post('/', validatePayment, asyncHandler(paymentController.createPayment));
router.patch('/:id/reconcile', asyncHandler(paymentController.reconcilePayment));
router.get('/download-receipt/:paymentId', asyncHandler(paymentController.downloadReceipt));

export default router;
