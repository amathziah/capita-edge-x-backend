import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId, validateInvoice, validateEmail } from '../../core/middleware/validation.js';
import { 
  getInvoices, getInvoiceById, createInvoice, updateInvoice,
  deleteInvoice, generatePdf, sendInvoiceEmail, bulkReminders,
  getInvoiceByShareToken, getInvoiceShareDetails, getNextInvoiceNumber, getInvoiceDraftDefaults, shareInvoice
} from './invoice.controller.js';

import { checkAndSendFollowUps } from './followUp.service.js';

const router = express.Router();

// Routes
router.get('/', asyncHandler(getInvoices));
router.get('/defaults', asyncHandler(getInvoiceDraftDefaults));
router.get('/next-number', asyncHandler(getNextInvoiceNumber));
router.post('/', validateInvoice, asyncHandler(createInvoice));
router.get('/share/:token/details', asyncHandler(getInvoiceShareDetails));
router.get('/share/:token', asyncHandler(getInvoiceByShareToken));
router.get('/:id', validateId, asyncHandler(getInvoiceById));
router.put('/:id', validateId, asyncHandler(updateInvoice));
router.delete('/:id', validateId, asyncHandler(deleteInvoice));

// Actions
router.get('/:id/pdf', validateId, asyncHandler(generatePdf));
router.post('/:id/share', validateId, asyncHandler(shareInvoice));
router.post('/:id/send', validateId, validateEmail, asyncHandler(sendInvoiceEmail));
router.post('/:id/reminder', validateId, validateEmail, asyncHandler(sendInvoiceEmail)); // Alias for reminders

// Note: /api/email/send-bulk-reminders was logically part of email/invoices. 
// Can be moved here or to a separate emailRoutes.
// router.post('/reminders/bulk', asyncHandler(invoiceController.bulkReminders));

// Cron: Automated Follow-Ups
router.post('/cron/follow-ups', asyncHandler(async (req, res) => {
    await checkAndSendFollowUps();
    res.json({ success: true });
}));

export default router;
