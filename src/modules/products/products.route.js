import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as productsController from './products.controller.js';

const router = express.Router();

// Public/Authenticated Routes
router.get('/products', asyncHandler(productsController.getProducts));
router.post('/products', asyncHandler(productsController.saveProduct));
router.get('/products/:id', asyncHandler(productsController.getProducts)); // Just return [] for now
router.delete('/products/:id', asyncHandler(productsController.deleteProduct));

// Analytics Integration points
router.get('/analytics/product-performance', asyncHandler(productsController.getProductPerformance));

export default router;
