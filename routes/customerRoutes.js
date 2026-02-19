import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateId, validateCustomer } from '../middleware/validation.js';
import * as customerController from '../controllers/customerController.js';

const router = express.Router();

router.get('/', asyncHandler(customerController.getCustomers));
router.post('/', validateCustomer, asyncHandler(customerController.createCustomer));
router.get('/:id', validateId, asyncHandler(customerController.getCustomerById));
router.delete('/:id', validateId, asyncHandler(customerController.deleteCustomer));

export default router;
