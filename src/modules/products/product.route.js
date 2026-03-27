import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId, validateProduct } from '../../core/middleware/validation.js';
import * as productController from './product.controller.js';

const router = express.Router();

router.get('/', asyncHandler(productController.getProducts));
router.post('/', validateProduct, asyncHandler(productController.createProduct));
router.delete('/:id', validateId, asyncHandler(productController.deleteProduct));

export default router;
