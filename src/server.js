import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { errorHandler, notFoundHandler } from './core/middleware/errorHandler.js';
import { authenticateUser } from './core/middleware/auth.js';
import { sanitizeInput } from './core/middleware/validation.js';
import redisService from './core/services/redis.service.js';
import aiEmbeddingIntentService from './modules/ai/intent/embedding.service.js';


// Routes
import aiRoutes from './modules/ai/ai.route.js';
import authRoutes from './modules/auth/auth.route.js';
import invoiceRoutes from './modules/invoices/invoice.route.js';
import customerRoutes from './modules/customers/customer.route.js';
import expenseRoutes from './modules/expenses/expense.route.js';
import paymentRoutes from './modules/payments/payment.route.js';
import complianceRoutes from './modules/compliance/compliance.route.js';
import notificationRoutes from './modules/notifications/notification.route.js';
import analyticsRoutes from './modules/analytics/analytics.route.js';
import systemRoutes from './modules/system/system.route.js';
import reportRoutes from './modules/reports/report.route.js';
import productsRoutes from './modules/products/products.route.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');

export const createApp = () => {
    const app = express();
    app.set('trust proxy', 1);

    // Security middleware
    app.use(helmet());

    // Hardened CORS Configuration
    const allowedOrigins = [
        process.env.APP_URL?.replace(/\/$/, ''), // Production Frontend (trim trailing slash)
        ...(process.env.CORS_ALLOWED_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim().replace(/\/$/, ''))
            .filter(Boolean),
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174',
        'https://capitaedgex.com',
        'https://www.capitaedgex.com'
    ].filter(Boolean);

    app.use(cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

            // Exact match from configured origins
            const isAllowed = allowedOrigins.some(allowed => origin === allowed);

            if (isAllowed) {
                return callback(null, true);
            }

            console.warn(`Blocked by CORS: ${origin}`);
            const err = new Error('CORS Policy Violation');
            err.statusCode = 403;
            return callback(err, false);
        },
        credentials: true
    }));

    app.use(express.json({ limit: '50mb' }));
    app.use(sanitizeInput);
    app.use('/api/uploads', express.static(UPLOAD_DIR, {
        setHeaders: (res) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none';");
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        }
    }));

    // Health Check Endpoint (For Render/Platform Monitoring)
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'UP',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    });

    // ============================================================================
    // API ROUTES (Authenticated)
    // ============================================================================

    // Authentication Middleware - Protects all /api routes (EXCEPT webhooks and shared invoices)
    app.use('/api/', (req, res, next) => {
        if (req.path.includes('/invoices/share/')) return next();
        if (req.path.includes('/auth/signup')) return next();
        if (req.path.includes('/auth/resend-confirmation')) return next();
        if (req.path.includes('/auth/verify-otp')) return next();
        authenticateUser(req, res, next);
    });

    // Mount Routes
    app.use('/api/auth', authRoutes);
    app.use('/api', aiRoutes); // Mount at /api to support /api/ai/* AND /api/negotiate-settlement
    app.use('/api/invoices', invoiceRoutes);
    app.use('/api/customers', customerRoutes);
    app.use('/api/expenses', expenseRoutes);
    app.use('/api/payments', paymentRoutes);
    app.use('/api/compliance', complianceRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/system', systemRoutes);
    app.use('/api', systemRoutes);

    app.use('/api/reports', reportRoutes);

    // Shared prefixes / General Routes
    app.use('/api', analyticsRoutes); // Handles /api/dashboard-stats, /api/analytics/*
    app.use('/api', productsRoutes); // Handles /api/products, /api/analytics/product-performance

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

    return app;
};

export const app = createApp();

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const startServer = async () => {
        await redisService.connect();
        await aiEmbeddingIntentService.initialize();
        
        app.listen(PORT, () => {
            console.log(`✅ Backend server running on http://localhost:${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    };
    
    startServer().catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}
