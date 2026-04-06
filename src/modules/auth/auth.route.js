import express from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from './auth.controller.js';
import { authenticateUser } from '../../core/middleware/auth.js';
import { LIMITS } from '../../core/config/constants.js';

const router = express.Router();

const buildAuthLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'anonymous';
        return `${req.ip}:${email}`;
    },
    message: { error: message }
});

const signupLimiter = buildAuthLimiter(
    LIMITS.AUTH_SIGNUP_WINDOW_MS,
    LIMITS.AUTH_SIGNUP_RATE_LIMIT,
    'Too many signup attempts. Please wait before trying again.'
);

const verifyOtpLimiter = buildAuthLimiter(
    LIMITS.AUTH_VERIFY_WINDOW_MS,
    LIMITS.AUTH_VERIFY_RATE_LIMIT,
    'Too many verification attempts. Please wait before trying again.'
);

const resendLimiter = buildAuthLimiter(
    LIMITS.AUTH_RESEND_WINDOW_MS,
    LIMITS.AUTH_RESEND_RATE_LIMIT,
    'Too many resend attempts. Please wait before requesting another code.'
);

// No auth — user has no token yet at these points
router.post('/signup',              signupLimiter, authController.signUp);
router.post('/verify-otp',          verifyOtpLimiter, authController.verifyOtp);

// Auth required — user must have a valid Supabase session token
router.post('/provision',           authenticateUser, authController.provisionOrganization);
router.post('/resend-confirmation', resendLimiter, authController.resendConfirmation);

export default router;
