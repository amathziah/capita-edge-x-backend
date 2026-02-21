import express from 'express';
import * as authController from '../controllers/authController.js';

const router = express.Router();

router.post('/provision', authController.provisionOrganization);

export default router;
