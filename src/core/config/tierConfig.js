// ═══════════════════════════════════════════════════════════════════════
//  Centralized Tier Configuration
//  Single source of truth for all plan limits, features, and metadata.
//  To add a new tier, just add an entry here.
// ═══════════════════════════════════════════════════════════════════════

export const PLAN_TIERS = {
    starter: {
        name: 'Starter',
        label: 'Free',
        price: 0,
        priceAnnual: 0,
        description: 'Get started with the essentials.',
        limits: {
            invoices: 5,
            ai_token_limit: 50000,
            products: 20,
            customers: 20,
        },
        features: {
            email_invoices: false,
            bulk_email: false,
            pdf_download: true,
            reports: 'basic',
            white_label: false,
            multi_client: false,
            priority_support: false,
        },
    },

    freelancer: {
        name: 'Freelancer',
        label: '₹499/mo',
        price: 499,
        priceAnnual: 4990,   // ~2 months free
        description: 'For freelancers and solopreneurs scaling up.',
        limits: {
            invoices: Infinity,
            ai_token_limit: 250000,
            products: Infinity,
            customers: Infinity,
        },
        features: {
            email_invoices: true,
            bulk_email: false,
            pdf_download: true,
            reports: 'full',
            white_label: false,
            multi_client: false,
            priority_support: false,
        },
    },

    smb: {
        name: 'SMB',
        label: '₹1,499/mo',
        price: 1499,
        priceAnnual: 14990,  // ~2 months free
        description: 'For growing teams and agencies.',
        limits: {
            invoices: Infinity,
            ai_token_limit: 1000000,
            products: Infinity,
            customers: Infinity,
        },
        features: {
            email_invoices: true,
            bulk_email: true,
            pdf_download: true,
            reports: 'full',
            white_label: false,
            multi_client: false,
            priority_support: true,
        },
    },

    ca_pro: {
        name: 'CA Pro',
        label: '₹10,000 setup + ₹500/client/mo',
        price: 10000,         // Setup fee
        pricePerClient: 500,  // Monthly per-client fee
        priceAnnual: null,    // Custom pricing
        description: 'White-label for Chartered Accountants.',
        limits: {
            invoices: Infinity,
            ai_token_limit: 500000,
            products: Infinity,
            customers: Infinity,
        },
        features: {
            email_invoices: true,
            bulk_email: true,
            pdf_download: true,
            reports: 'full',
            white_label: true,
            multi_client: true,
            priority_support: true,
        },
    },

    enterprise: {
        name: 'Enterprise',
        label: 'Custom',
        price: null,          // Contact sales
        priceAnnual: null,
        description: 'Custom solutions for large organizations.',
        limits: {
            invoices: Infinity,
            ai_token_limit: Infinity,
            products: Infinity,
            customers: Infinity,
        },
        features: {
            email_invoices: true,
            bulk_email: true,
            pdf_download: true,
            reports: 'custom',
            white_label: true,
            multi_client: true,
            priority_support: true,
        },
    },
};

/**
 * Get config for a specific tier. Falls back to 'starter' for unknown tiers.
 */
export const getTierConfig = (tier) => {
    return PLAN_TIERS[tier] || PLAN_TIERS.starter;
};

/**
 * Get the limit value for a specific resource on a tier.
 */
export const getTierLimit = (tier, resource) => {
    const config = getTierConfig(tier);
    return config.limits[resource] ?? 0;
};

/**
 * Check if a tier has a specific feature enabled.
 */
export const hasTierFeature = (tier, feature) => {
    const config = getTierConfig(tier);
    const val = config.features[feature];
    return val === true || val === 'full' || val === 'custom' || val === 'basic';
};



// ═══════════════════════════════════════════════════════════════════════
//  AI PRICING & EXCHANGE RATES
// ═══════════════════════════════════════════════════════════════════════

export const AI_PRICING = {
    'gemini-3.1-flash-preview': {
        inputPer1M: 0.10,  // USD (Est)
        outputPer1M: 0.40,  // USD (Est)
    },
    'gemini-3-flash-preview': {
        inputPer1M: 0.10,
        outputPer1M: 0.40,
    },
    'gemini-2.5-flash': {
        inputPer1M: 0.075,
        outputPer1M: 0.30,
    },
    'gemini-2.5-pro': {
        inputPer1M: 0.125,
        outputPer1M: 0.375,
    },
    'gemini-2.0-flash': {
        inputPer1M: 0.075,
        outputPer1M: 0.30,
    },
};

export const EXCHANGE_RATE = {
    USD_TO_INR: 83.0,
};

/**
 * All valid tier slugs.
 */
export const VALID_TIERS = Object.keys(PLAN_TIERS);
