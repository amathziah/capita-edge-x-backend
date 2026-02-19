import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateId, validateProduct } from '../middleware/validation.js';
import * as productController from '../controllers/productController.js';

const router = express.Router();

router.get('/', asyncHandler(productController.getProducts));
router.post('/', validateProduct, asyncHandler(productController.createProduct));
router.delete('/:id', validateId, asyncHandler(productController.deleteProduct));

export default router;
