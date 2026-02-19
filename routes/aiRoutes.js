import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as aiController from '../controllers/aiController.js';

const router = express.Router();

// AI Rate Limiter (Strict)
const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 requests per windowMs
    message: { error: 'Too many AI requests, please try again later.' }
});

// Apply strict limit to all AI routes
// Apply strict limit ONLY to AI routes (not globally to the router if mounted at root)
// router.use(aiLimiter); // REMOVED to prevent affecting other /api routes

// Routes
router.post('/ai/chat', aiLimiter, asyncHandler(aiController.processChat));
router.post('/ai/magic-fill', aiLimiter, asyncHandler(aiController.magicFill));
router.get('/ai/insights', aiLimiter, asyncHandler(aiController.getInsights));
router.get('/ai/predict-revenue', aiLimiter, asyncHandler(aiController.predictRevenue));
router.post('/ai/command', aiLimiter, asyncHandler(aiController.processCommand));

// Legacy /negotiate-settlement route (called from client/src/services/dataService.ts)
router.post('/negotiate-settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

// Standard new route
router.post('/ai/settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

export default router;
