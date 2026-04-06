import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import * as analyticsController from './analytics.controller.js';

const router = express.Router();

// Dashboard
router.get('/dashboard-stats', asyncHandler(analyticsController.getDashboardStats)); // Note: Frontend calls /api/dashboard-stats, not /api/analytics/dashboard-stats. We might need to remap or alias.
// Current frontend usage: /api/dashboard-stats. 
// If we mount this router at /api/analytics, it becomes /api/analytics/dashboard-stats.
// I will keep the path relative to the mount point.
// If mounted at /api, then:
// router.get('/dashboard-stats', ...) -> /api/dashboard-stats
// router.get('/analytics/revenue-trends', ...) -> /api/analytics/revenue-trends
// Ideally, all analytics go under /api/analytics.
// I'll create a router that can be mounted at /api/analytics, EXCEPT dashboard-stats which is top-level /api.
// Actually, for simplicity, I should make `analyticsRoutes.js` handle `/analytics/*` and maybe a separate `dashboardRoutes.js` or just mount specific paths in server.js?
// No, standard practice: Mount `analyticsRoutes` at `/api/analytics`.
// And `dashboard-stats`... well, it IS analytics.
// Check frontend usage. If I change URL, frontend breaks.
// I'll define dashboard-stats locally here but implementation in controller.
// In `server.js` I will likely mount this router at `/api/analytics`.
// So `router.get('/revenue-trends')` becomes `/api/analytics/revenue-trends`.
// But `dashboard-stats` is used as `/api/dashboard-stats`.
// I will export meaningful routes here.
// I'll include dashboard-stats in this file, BUT I'll need to mount this router specially or handle dashboard-stats separately in server.js.
// BETTER: Mount this router at `/api`.
// Then:
// router.get('/dashboard-stats', ...)
// router.get('/analytics/revenue-trends', ...)
// This preserves all paths within one "analytics" router file which is a bit messy (mixed prefixes) but works for refactoring without breaking frontend.

router.get('/dashboard-stats', asyncHandler(analyticsController.getDashboardStats));
router.get('/analytics/revenue-trends', asyncHandler(analyticsController.getRevenueTrends));
router.get('/analytics/customer-insights', asyncHandler(analyticsController.getCustomerInsights));
router.get('/analytics/product-performance', asyncHandler(analyticsController.getProductPerformance));
router.get('/analytics/cash-flow', asyncHandler(analyticsController.getCashFlow));
router.get('/analytics/health-score', asyncHandler(analyticsController.getHealthScore));
router.get('/analytics/safe-to-spend', asyncHandler(analyticsController.getSafeToSpend));
router.get('/analytics/export', asyncHandler(analyticsController.exportData));
router.get('/analytics/persona-stats', asyncHandler(analyticsController.getPersonaStats));

export default router;
