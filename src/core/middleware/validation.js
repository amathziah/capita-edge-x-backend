import { body, param, query, validationResult } from 'express-validator';

/**
 * Validation Middleware
 * Provides input validation for all API endpoints
 */

/**
 * Handle validation errors
 */
export const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

/**
 * Customer validation rules
 */
export const validateCustomer = [
    body('name').trim().notEmpty().withMessage('Customer name is required'),
    body('email').optional().isEmail().withMessage('Invalid email address'),
    body('phone').optional().trim(),
    body('address').optional().trim(),
    handleValidationErrors
];

/**
 * Product validation rules
 */
export const validateProduct = [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('minStock').optional().isInt({ min: 0 }).withMessage('Minimum stock must be a non-negative integer'),
    body('unit').optional().trim(),
    handleValidationErrors
];

/**
 * Invoice validation rules
 */
export const validateInvoice = [
    body('invoiceNumber').trim().notEmpty().withMessage('Invoice number is required'),
    body('buyer').isObject().withMessage('Buyer information is required'),
    body('buyer.name').trim().notEmpty().withMessage('Buyer name is required'),
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.description').trim().notEmpty().withMessage('Item description is required'),
    body('items.*.quantity').isFloat({ min: 0 }).withMessage('Quantity must be positive'),
    body('items.*.price').isFloat({ min: 0 }).withMessage('Price must be positive'),
    body('subtotal').isFloat({ min: 0 }).withMessage('Subtotal must be positive'),
    body('total').isFloat({ min: 0 }).withMessage('Total must be positive'),
    body('date').optional().isISO8601().withMessage('Invalid date format'),
    body('seller').optional().isObject().withMessage('Seller must be an object'),
    body('shipTo').optional().isObject().withMessage('ShipTo must be an object'),
    body('taxType').optional().isString().withMessage('Tax type must be a string'),
    body('taxRate').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Tax rate must be zero or positive'),
    body('discount').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Discount must be zero or positive'),
    body('shipping').optional({ values: 'falsy' }).isFloat({ min: 0 }).withMessage('Shipping must be zero or positive'),
    body('notes').optional().isString().withMessage('Notes must be a string'),
    body('status').optional().isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled']).withMessage('Invalid status'),
    handleValidationErrors
];

/**
 * Payment validation rules
 */
export const validatePayment = [
    body('invoiceId').trim().notEmpty().withMessage('Invoice ID is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
    body('method').optional().isIn(['cash', 'bank_transfer', 'upi', 'card', 'cheque']).withMessage('Invalid payment method'),
    body('date').optional().isISO8601().withMessage('Invalid date format'),
    handleValidationErrors
];

/**
 * Expense validation rules
 */
export const validateExpense = [
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be positive'),
    body('date').optional().isISO8601().withMessage('Invalid date format'),
    body('category').optional().trim(),
    handleValidationErrors
];

/**
 * Settings validation rules
 */
export const validateSettings = [
    body('businessName').optional().trim(),
    body('email').optional().isEmail().withMessage('Invalid email address'),
    body('phone').optional().trim(),
    body('address').optional().trim(),
    handleValidationErrors
];

/**
 * Email validation rules
 */
export const validateEmail = [
    body('to').isEmail().withMessage('Valid recipient email is required'),
    body('invoiceId').optional().trim(),
    handleValidationErrors
];

/**
 * ID parameter validation
 */
export const validateId = [
    param('id').trim().notEmpty().withMessage('ID is required'),
    handleValidationErrors
];

/**
 * Sanitize input to prevent XSS
 */
export const sanitizeInput = (req, res, next) => {
    const sanitize = (obj) => {
        if (typeof obj === 'string') {
            // Basic XSS sanitization (strips HTML tags, javascript: URIs, and inline event handlers)
            return obj.replace(/<[^>]*>?/gm, '')
                      .replace(/javascript\s*:/gi, '')
                      .replace(/on\w+\s*=/gi, '');
        }
        if (typeof obj === 'object' && obj !== null) {
            Object.keys(obj).forEach(key => {
                obj[key] = sanitize(obj[key]);
            });
        }
        return obj;
    };

    if (req.body) {
        Object.keys(req.body).forEach(key => {
            req.body[key] = sanitize(req.body[key]);
        });
    }
    if (req.query) {
        Object.keys(req.query).forEach(key => {
            req.query[key] = sanitize(req.query[key]);
        });
    }
    if (req.params) {
        Object.keys(req.params).forEach(key => {
            req.params[key] = sanitize(req.params[key]);
        });
    }

    next();
};
