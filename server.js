import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticateUser } from './middleware/auth.js';
import { sanitizeInput } from './middleware/validation.js';
import { checkPlanLimits } from './middleware/checkPlan.js';

// Routes
import aiRoutes from './routes/aiRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import productRoutes from './routes/productRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import settingRoutes from './routes/settingRoutes.js';
import complianceRoutes from './routes/complianceRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import webhookRoutes from './routes/webhooks.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(sanitizeInput);

// ============================================================================
// WEBHOOKS
// ============================================================================
app.use('/api/webhooks', express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}), webhookRoutes);

// ============================================================================
// API ROUTES (Authenticated)
// ============================================================================

// Authentication Middleware - Protects all /api routes (EXCEPT webhooks)
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/webhooks')) return next();
    authenticateUser(req, res, next);
});

// Plan Liimits
app.use('/api/', checkPlanLimits);

// Mount Routes
app.use('/api', aiRoutes); // Mount at /api to support /api/ai/* AND /api/negotiate-settlement
app.use('/api/invoices', invoiceRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/notifications', notificationRoutes);

// Shared prefixes / General Routes
app.use('/api', settingRoutes);   // Handles /api/settings, /api/inventory/settings
app.use('/api', uploadRoutes);    // Handles /api/upload/logo, /api/uploads/*
app.use('/api', analyticsRoutes); // Handles /api/dashboard-stats, /api/analytics/*

// SERVE FRONTEND (Optional)
const CLIENT_BUILD_PATH = path.join(__dirname, 'dist');
if (fs.existsSync(CLIENT_BUILD_PATH)) {
    app.use(express.static(CLIENT_BUILD_PATH));
    app.get(/(.*)/, (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
        }
    });
}

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`✅ Backend server running on http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
