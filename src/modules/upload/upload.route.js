import express from 'express';
import { asyncHandler } from '../../core/middleware/errorHandler.js';
import { validateId } from '../../core/middleware/validation.js';
import { upload } from './file.service.js';
import * as uploadController from './upload.controller.js';

const router = express.Router();

// Mount at /api
// POST /api/upload/logo
router.post('/upload/logo', upload.single('logo'), asyncHandler(uploadController.uploadLogo));

// GET /api/uploads/logos/:filename
router.get('/uploads/logos/:filename', uploadController.getLogo); // Not async, uses res.sendFile

// DELETE /api/uploads/:filename
router.delete('/uploads/:filename', validateId, asyncHandler(uploadController.deleteLogo));

export default router;
