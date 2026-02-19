import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as settingController from '../controllers/settingController.js';

const router = express.Router();

// General
router.get('/settings', asyncHandler(settingController.getSettings));
router.post('/settings', asyncHandler(settingController.updateSetting));

// Inventory
router.get('/inventory/settings', asyncHandler(settingController.getInventorySettings)); // Maps to /api/inventory/settings if mounted at /api? 
// No, if mounted at /api/settings, this becomes /api/settings/inventory/settings.
// I should likely mount this router at `/api` to handle dispersed paths, OR structure it better.
// Given strict refactor, I should probably put inventory settings in `inventoryController`?
// But user calls `/api/inventory/settings`.
// I will mount this router at `/api` in server.js to preserve paths.
// So `router.get('/settings')` -> `/api/settings`
// `router.get('/inventory/settings')` -> `/api/inventory/settings`

router.get('/inventory/settings', asyncHandler(settingController.getInventorySettings));
router.post('/inventory/settings', asyncHandler(settingController.updateInventorySettings));

// Email Test
router.post('/email/test-connection', asyncHandler(settingController.testSmtpConnection));

export default router;
