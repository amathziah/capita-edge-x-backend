import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId, validateInvoice, validateEmail } from '../../core/middleware/validation.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { LIMITS } from '../../core/config/constants.js';
import { 
  getInvoices, getInvoiceById, createInvoice, updateInvoice,
  deleteInvoice, generatePdf, sendInvoiceEmail, bulkReminders,
  getInvoiceByShareToken, getInvoiceShareDetails, getNextInvoiceNumber, getInvoiceDraftDefaults, shareInvoice, revokeSharedInvoice
} from './invoice.controller.js';

import { checkAndSendFollowUps } from './followUp.service.js';

const router = express.Router();

const publicShareLimiter = rateLimit({
  windowMs: LIMITS.SHARE_PUBLIC_WINDOW_MS,
  max: LIMITS.SHARE_PUBLIC_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many share link requests. Please wait and try again.' }
});

const invoiceActionLimiter = rateLimit({
  windowMs: LIMITS.INVOICE_ACTION_WINDOW_MS,
  max: LIMITS.INVOICE_ACTION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => `${req.user?.id || req.ip}:${req.params.id || 'all'}`,
  message: { error: 'Too many invoice actions. Please wait before trying again.' }
});

const requireOwnerOrAdmin = (req, _res, next) => {
  if (req.user?.role === 'owner' || req.user?.role === 'admin') {
    return next();
  }
  next(new APIError('Only organization owners or admins can trigger follow-up jobs', 403));
};

// Routes
router.get('/', asyncHandler(getInvoices));
router.get('/defaults', asyncHandler(getInvoiceDraftDefaults));
router.get('/next-number', asyncHandler(getNextInvoiceNumber));
router.post('/', validateInvoice, asyncHandler(createInvoice));
router.get('/share/:token/details', publicShareLimiter, asyncHandler(getInvoiceShareDetails));
router.get('/share/:token', publicShareLimiter, asyncHandler(getInvoiceByShareToken));
router.get('/:id', validateId, asyncHandler(getInvoiceById));
router.put('/:id', validateId, asyncHandler(updateInvoice));
router.delete('/:id', validateId, asyncHandler(deleteInvoice));

// Actions
router.get('/:id/pdf', validateId, asyncHandler(generatePdf));
router.post('/:id/share', validateId, invoiceActionLimiter, asyncHandler(shareInvoice));
router.post('/:id/share/revoke', validateId, invoiceActionLimiter, asyncHandler(revokeSharedInvoice));
router.post('/:id/send', validateId, invoiceActionLimiter, validateEmail, asyncHandler(sendInvoiceEmail));
router.post('/:id/reminder', validateId, invoiceActionLimiter, validateEmail, asyncHandler(sendInvoiceEmail)); // Alias for reminders

// Note: /api/email/send-bulk-reminders was logically part of email/invoices. 
// Can be moved here or to a separate emailRoutes.
// router.post('/reminders/bulk', asyncHandler(invoiceController.bulkReminders));

// Cron: Automated Follow-Ups
router.post('/cron/follow-ups', invoiceActionLimiter, requireOwnerOrAdmin, asyncHandler(async (req, res) => {
    await checkAndSendFollowUps();
    res.json({ success: true });
}));

export default router;
