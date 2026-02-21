import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateId, validateInvoice, validateEmail } from '../middleware/validation.js';
import * as invoiceController from '../controllers/invoiceController.js';

const router = express.Router();

// Routes
router.get('/', asyncHandler(invoiceController.getInvoices));
router.get('/next-number', asyncHandler(invoiceController.getNextInvoiceNumber));
router.post('/', validateInvoice, asyncHandler(invoiceController.createInvoice));
router.get('/:id', validateId, asyncHandler(invoiceController.getInvoiceById));
router.get('/share/:token', asyncHandler(invoiceController.getInvoiceByShareToken));
router.put('/:id', validateId, asyncHandler(invoiceController.updateInvoice));
router.delete('/:id', validateId, asyncHandler(invoiceController.deleteInvoice));

// Actions
router.get('/:id/pdf', validateId, asyncHandler(invoiceController.generatePdf));
router.post('/:id/send', validateId, validateEmail, asyncHandler(invoiceController.sendInvoiceEmail));
router.post('/:id/reminder', validateId, validateEmail, asyncHandler(invoiceController.sendInvoiceEmail)); // Alias for reminders

// Note: /api/email/send-bulk-reminders was logically part of email/invoices. 
// Can be moved here or to a separate emailRoutes.
// router.post('/reminders/bulk', asyncHandler(invoiceController.bulkReminders));

export default router;
