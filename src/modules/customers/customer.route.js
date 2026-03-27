import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId, validateCustomer } from '../../core/middleware/validation.js';
import * as customerController from './customer.controller.js';

const router = express.Router();

router.get('/', asyncHandler(customerController.getCustomers));
router.post('/', validateCustomer, asyncHandler(customerController.createCustomer));
router.get('/:id', validateId, asyncHandler(customerController.getCustomerById));
router.get('/:id/insights', validateId, asyncHandler(customerController.getCustomerInsights));
router.get('/:id/invoices', validateId, asyncHandler(customerController.getCustomerInvoices));
router.delete('/:id', validateId, asyncHandler(customerController.deleteCustomer));

export default router;
