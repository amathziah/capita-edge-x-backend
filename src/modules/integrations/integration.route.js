import express from 'express';
import { authenticateUser } from '../../core/middleware/auth.js';
import * as googleController from './google.controller.js';

const router = express.Router();

// Route to get the Google Auth URL
router.get('/google/auth', authenticateUser, googleController.getAuthUrl);

// Route for the callback (exchanging code for token)
// Note: Frontend might handle the redirect and just POST the code here.
router.post('/google/callback', authenticateUser, googleController.oauthCallback);

// Get current integration status
router.get('/google/status', authenticateUser, googleController.getIntegrationStatus);

// Disconnect Google integration
router.post('/google/disconnect', authenticateUser, googleController.disconnectGoogle);

export default router;
