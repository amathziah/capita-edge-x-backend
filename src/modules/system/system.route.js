import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as systemController from './system.controller.js';
import { LIMITS } from '../../core/config/constants.js';

const router = express.Router();

const systemActionLimiter = rateLimit({
    windowMs: LIMITS.SYSTEM_ACTION_WINDOW_MS,
    max: LIMITS.SYSTEM_ACTION_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Too many system actions. Please wait before trying again.' }
});

router.get('/settings', asyncHandler(systemController.getSettings));
router.post('/settings', asyncHandler(systemController.saveSetting));
router.get('/inventory/settings', asyncHandler(systemController.getInventorySettings));
router.post('/inventory/settings', asyncHandler(systemController.saveInventorySettings));
router.post('/email/test-connection', systemActionLimiter, asyncHandler(systemController.testEmailConnection));
router.post(
    '/upload/logo',
    systemActionLimiter,
    systemController.uploadLogoMiddleware.single('logo'),
    asyncHandler(systemController.uploadLogo)
);
router.post(
    '/upload/payment-qr',
    systemActionLimiter,
    systemController.uploadPaymentQrMiddleware.single('paymentQr'),
    asyncHandler(systemController.uploadPaymentQr)
);

// router.post('/run-catalog-stress', asyncHandler(systemController.runCatalogStressTest));

export default router;
