import express from 'express';
import * as authController from '../controllers/authController.js';

const router = express.Router();

router.post('/provision', authController.provisionOrganization);
router.post('/resend-confirmation', authController.resendConfirmation);
router.post('/signup', authController.signUp);
router.post('/verify-otp', authController.verifyOtp);

export default router;
