/**
 * Error Handler Middleware
 * Centralized error handling for consistent API responses
 */
import fs from 'fs';

/**
 * Custom API Error class
 */
export class APIError extends Error {
    constructor(message, statusCode = 500, errors = []) {
        super(message);
        this.statusCode = statusCode;
        this.errors = errors;
        this.name = 'APIError';
    }
}

/**
 * Global error handler middleware
 */
export const errorHandler = (err, req, res, next) => {
    console.error('Error:', err);

    // Log to file (async, non-blocking)
    const log = `[${new Date().toISOString()}] ${err.stack || err.message}\n`;
    fs.appendFile('./error.log', log, (writeErr) => {
        if (writeErr) console.error('Failed to write error log:', writeErr);
    });

    // Default error response
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';
    let errors = err.errors || [];

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation Error';
        errors = Object.values(err.errors).map(e => e.message);
    }

    if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
    }

    if (err.code === 'SQLITE_CONSTRAINT') {
        statusCode = 409;
        message = 'Database constraint violation';
    }

    // Don't expose generic internal errors in production, but allow explicit APIError messages
    if (process.env.NODE_ENV === 'production' && statusCode === 500 && err.name !== 'APIError') {
        message = 'Something went wrong. Please try again later.';
    }

    res.status(statusCode).json({
        success: false,
        error: message,
        errors: errors.length > 0 ? errors : undefined,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        path: req.originalUrl
    });
};

/**
 * Async handler wrapper to catch errors in async routes
 */
export const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
