import express from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as aiController from './controllers/ai.controller.js';
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

// Meta Rate Limiter (Relaxed for UI/Status checks)
const metaLimiter = rateLimit({
    windowMs: LIMITS.AI_RATE_WINDOW_MS,
    max: LIMITS.META_RATE_LIMIT || 100,
    message: { error: 'Too many status check requests, please wait.' },
    keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
    validate: false
});

// Routes
router.post('/ai/chat', aiLimiter, asyncHandler(aiController.processChat));
router.post('/ai/chat/stream', aiLimiter, aiController.processChatStream); // SSE — no asyncHandler (manages its own response lifecycle)
router.get('/ai/workspaces/:domain', metaLimiter, asyncHandler(aiController.getDomainWorkspace));
router.post('/ai/magic-fill', aiLimiter, asyncHandler(aiController.magicFill));
router.get('/ai/insights', aiLimiter, asyncHandler(aiController.getInsights));
router.get('/ai/predict-revenue', aiLimiter, asyncHandler(aiController.predictRevenue));
router.post('/ai/predict-revenue', aiLimiter, asyncHandler(aiController.predictRevenue));
router.get('/ai/usage', metaLimiter, asyncHandler(aiController.getAIUsageStatus)); // Use metaLimiter
router.post('/ai/command', aiLimiter, asyncHandler(aiController.processCommand));
router.post('/ai/audit-invoice', aiLimiter, asyncHandler(aiController.auditInvoice));
router.get('/ai/conversations', aiLimiter, asyncHandler(aiController.getConversations));
router.get('/ai/conversations/:id', aiLimiter, asyncHandler(aiController.getConversationMessages));
router.get('/ai/history', aiLimiter, asyncHandler(aiController.getChatHistory));
router.delete('/ai/history', aiLimiter, asyncHandler(aiController.deleteChatHistory));
router.get('/ai/traces', metaLimiter, asyncHandler(aiController.getTraces));
router.get('/ai/traces/:traceId', metaLimiter, asyncHandler(aiController.getTraceById));
router.post('/ai/actions/execute', aiLimiter, asyncHandler(aiController.executeAction));
router.get('/ai/config', metaLimiter, asyncHandler(aiController.getConfig)); // Use metaLimiter
router.get('/ai/budget', metaLimiter, asyncHandler(aiController.getBudget)); // Daily AI budget status

// Smart Collections
router.post('/ai/collections/generate-draft', aiLimiter, asyncHandler(aiController.generateCollectionDraft));
router.post('/ai/collections/send', aiLimiter, asyncHandler(aiController.sendCollectionReminder));

// Legacy /negotiate-settlement route (called from client/src/services/dataService.ts)
router.post('/negotiate-settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

// Standard new route
router.post('/ai/settlement', aiLimiter, asyncHandler(aiController.negotiateSettlement));

export default router;
