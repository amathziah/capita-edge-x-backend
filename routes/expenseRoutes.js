import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateId, validateExpense } from '../middleware/validation.js';
import * as expenseController from '../controllers/expenseController.js';

const router = express.Router();

router.get('/', asyncHandler(expenseController.getExpenses));
router.post('/', validateExpense, asyncHandler(expenseController.createExpense));
router.delete('/:id', validateId, asyncHandler(expenseController.deleteExpense));

export default router;
