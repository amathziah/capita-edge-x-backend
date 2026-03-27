import express from 'express';
import * as reportController from './report.controller.js';

const router = express.Router();

router.post('/', reportController.createReport);
router.get('/', reportController.getReports);

export default router;
