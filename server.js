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
import authRoutes from './routes/authRoutes.js';
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
import systemRoutes from './routes/systemRoutes.js';
import webhookRoutes from './routes/webhooks.js';
import planRoutes from './routes/planRoutes.js';
import reportRoutes from './routes/reportRoutes.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// Hardened CORS Configuration
const allowedOrigins = [
    process.env.APP_URL, // Production Frontend
    'http://localhost:5173', // Local Dev
    'http://localhost:5174'  // Local Dev Alternative
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Exact match from configured origins
        const isAllowed = allowedOrigins.some(allowed => origin === allowed);
        
        // Flexible match for Vercel preview/deployment URLs
        const isVercel = origin.endsWith('.vercel.app');

        if (isAllowed || isVercel) {
            return callback(null, true);
        }
        
        console.warn(`Blocked by CORS: ${origin}`);
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
    },
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(sanitizeInput);

// Health Check Endpoint (For Render/Platform Monitoring)
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

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

// Authentication Middleware - Protects all /api routes (EXCEPT webhooks and shared invoices)
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/webhooks')) return next();
    if (req.path.includes('/invoices/share/')) return next();
    if (req.path.includes('/auth/signup')) return next();
    if (req.path.includes('/auth/resend-confirmation')) return next();
    if (req.path.includes('/auth/verify-otp')) return next();
    authenticateUser(req, res, next);
});

// Plan Liimits
app.use('/api/', checkPlanLimits);

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api', aiRoutes); // Mount at /api to support /api/ai/* AND /api/negotiate-settlement
app.use('/api/invoices', invoiceRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/reports', reportRoutes);

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
