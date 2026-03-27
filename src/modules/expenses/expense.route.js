import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId, validateExpense } from '../../core/middleware/validation.js';
import * as expenseController from './expense.controller.js';

const router = express.Router();

router.get('/', asyncHandler(expenseController.getExpenses));
router.post('/', validateExpense, asyncHandler(expenseController.createExpense));
router.delete('/:id', validateId, asyncHandler(expenseController.deleteExpense));

export default router;
