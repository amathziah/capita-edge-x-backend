import { DEFAULTS } from '../config/constants.js';

/**
 * Standardize currency formatting across the backend.
 * @param {number} amount
 * @param {string} currencyCode e.g., 'INR', 'USD'
 * @returns {string} Formatted string, e.g., '₹1,000.00'
 */
export const formatCurrency = (amount, currencyCode = DEFAULTS.CURRENCY) => {
    try {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount || 0);
    } catch (e) {
        // Fallback for invalid currency codes
        return `${currencyCode} ${(amount || 0).toFixed(2)}`;
    }
};

/**
 * Get the currency symbol for a given currency code.
 * @param {string} currencyCode e.g., 'INR', 'USD'
 * @returns {string} Currency symbol, e.g., '₹', '$'
 */
export const getCurrencySymbol = (currencyCode = DEFAULTS.CURRENCY) => {
    try {
        const formatter = new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
        const parts = formatter.formatToParts(0);
        const symbolPart = parts.find(part => part.type === 'currency');
        return symbolPart ? symbolPart.value : currencyCode;
    } catch (e) {
        return currencyCode;
    }
};
