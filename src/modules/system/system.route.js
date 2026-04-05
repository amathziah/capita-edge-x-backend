import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as systemController from './system.controller.js';

const router = express.Router();

router.get('/settings', asyncHandler(systemController.getSettings));
router.post('/settings', asyncHandler(systemController.saveSetting));
router.get('/inventory/settings', asyncHandler(systemController.getInventorySettings));
router.post('/inventory/settings', asyncHandler(systemController.saveInventorySettings));
router.post('/email/test-connection', asyncHandler(systemController.testEmailConnection));
router.post(
    '/upload/logo',
    systemController.uploadLogoMiddleware.single('logo'),
    asyncHandler(systemController.uploadLogo)
);

// router.post('/run-catalog-stress', asyncHandler(systemController.runCatalogStressTest));

export default router;
