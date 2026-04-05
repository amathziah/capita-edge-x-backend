/**
 * Centralized Constants
 * Single source of truth for all defaults, thresholds, and magic numbers.
 * Previously scattered across 15+ files.
 */

// ─── Business Defaults ──────────────────────────────────────────────────────
export const DEFAULTS = {
    CURRENCY: 'INR',
    CURRENCY_SYMBOL: '₹',
    COUNTRY: 'India',
    TAX_LABEL: 'GST',
    TAX_TYPE: 'GST',
    DEFAULT_TAX_RATE: 18,
    INVOICE_PREFIX: 'INV-',
    DEFAULT_PERSONA: 'solopreneur',
    PLAN_TIER: 'free',
    DEFAULT_REORDER_LEVEL: 10,

    // OTP
    OTP_EXPIRY_MS: 15 * 60 * 1000,        // 15 minutes
    OTP_EXPIRY_DISPLAY: '15 minutes',

    // Follow-up cadence (days) — used when org config not set
    FOLLOW_UP_DAY_1: 7,
    FOLLOW_UP_DAY_2: 14,
    FOLLOW_UP_DAY_3: 30,
    MAX_FOLLOW_UPS: 3,
};

// ─── System Limits ──────────────────────────────────────────────────────────
export const LIMITS = {
    JSON_BODY_SIZE: '50mb',
    FILE_UPLOAD_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
    AI_RATE_LIMIT: parseInt(process.env.AI_RATE_LIMIT) || 30, // Increased from 10
    META_RATE_LIMIT: 100, // For usage and config checks
    AI_RATE_WINDOW_MS: 60 * 1000,
    AI_CACHE_TTL_MS: (parseInt(process.env.AI_CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000,
    MAX_INVOICE_RETRIES: 50,
    MAX_NOTIFICATIONS: 10,
    MAX_COMPLIANCE_NOTIFICATIONS: 3,
    DEFAULT_PAGE_LIMIT: 20,
    MAX_PAGE_LIMIT: 1000,
};

// ─── Analytics: Business Health Score ────────────────────────────────────────
export const HEALTH_SCORE = {
    REVENUE_BENCHMARK: 100000,
    REVENUE_MAX_POINTS: 40,
    OVERDUE_MAX_PENALTY: 30,
    CASH_FLOW_MAX_BONUS: 30,
    CASH_FLOW_SCALING: 10000,
    STOCK_FULL_BONUS: 30,
    STOCK_PARTIAL_BONUS: 20,
};

// ─── Customer Health Score ──────────────────────────────────────────────────
export const CUSTOMER_HEALTH = {
    BASELINE: 70,
    INVOICE_BONUS_THRESHOLD: 5,
    INVOICE_BONUS: 10,
    REVENUE_BONUS_THRESHOLD: 50000,
    REVENUE_BONUS: 10,
    OVERDUE_PENALTY: 20,
    VIP_THRESHOLD: 90,
    ACTIVE_THRESHOLD: 80,
    AT_RISK_THRESHOLD: 50,

    // Churn Risk Math
    DEFAULT_AVG_INTERVAL_DAYS: 30,
    MAX_CHURN_RISK: 100,
    CRITICAL_RISK_THRESHOLD: 80,
    MODERATE_RISK_THRESHOLD: 40,
};

// ─── Tax Reserve Estimates (Safe-to-Spend) ──────────────────────────────────
export const TAX_RESERVES = {
    GST_RATE: 0.18,
    INCOME_TAX_RATE: 0.10,
    OVERDUE_RISK_FACTOR: 0.50,
};

// ─── Placeholder Metrics (to be replaced with real calculations) ────────────
export const PLACEHOLDERS = {
    ECOMMERCE_NET_MARGINS: 18,
    SERVICES_PROJECT_HEALTH: 85,
};
