import express from 'express';
import * as authController from './auth.controller.js';
import { authenticateUser } from '../../core/middleware/auth.js';

const router = express.Router();

// No auth — user has no token yet at these points
router.post('/signup',              authController.signUp);
router.post('/verify-otp',          authController.verifyOtp);

// Auth required — user must have a valid Supabase session token
router.post('/provision',           authenticateUser, authController.provisionOrganization);
router.post('/resend-confirmation', authController.resendConfirmation);

export default router;
