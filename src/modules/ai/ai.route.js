import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as aiController from './ai.controller.js';
import { LIMITS } from '../../core/config/constants.js';

const router = express.Router();

// AI Rate Limiter (Strict)
const aiLimiter = rateLimit({
    windowMs: LIMITS.AI_RATE_WINDOW_MS,
    max: LIMITS.AI_RATE_LIMIT,
    message: { error: 'Too many AI requests, please try again later.' },
    // Use User ID for precision limiting, fallback to robust IP detection
    keyGenerator: (req) => req.user?.id || req.ip || req.socket.remoteAddress || 'anonymous',
    // Disable built-in validation checks to prevent startup noise in this proxy environment
    validate: false
});

// Apply strict limit to all AI routes
// Apply strict limit ONLY to AI routes (not globally to the router if mounted at root)
// router.use(aiLimiter); // REMOVED to prevent affecting other /api routes

// Routes
router.post('/ai/chat', aiLimiter, asyncHandler(aiController.processChat));
router.post('/ai/magic-fill', aiLimiter, asyncHandler(aiController.magicFill));
router.get('/ai/insights', aiLimiter, asyncHandler(aiController.getInsights));
router.get('/ai/predict-revenue', aiLimiter, asyncHandler(aiController.predictRevenue));
router.get('/ai/usage', aiLimiter, asyncHandler(aiController.getAIUsageStatus));
router.post('/ai/command', aiLimiter, asyncHandler(aiController.processCommand));
router.get('/ai/config', aiLimiter, asyncHandler(aiController.getConfig));

// Smart Collections
router.post('/ai/collections/generate-draft', aiLimiter, asyncHandler(aiController.generateCollectionDraft));
router.post('/ai/collections/send', aiLimiter, asyncHandler(aiController.sendCollectionReminder));

// Legacy /negotiate-settlement route (called from client/src/services/dataService.ts)
router.post('/negotiate-settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

// Standard new route
router.post('/ai/settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

export default router;
