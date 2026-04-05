// ═══════════════════════════════════════════════════════════════════════
//  Centralized Tier Configuration
//  Single source of truth for all plan limits, features, and metadata.
//  To add a new tier, just add an entry here.
// ═══════════════════════════════════════════════════════════════════════

export const PLAN_TIERS = {

    // ─── Free (Starter) ──────────────────────────────────────────────────────
    starter: {
        name: 'Free',
        label: 'Free forever',
        badge: null,
        price: 0,
        priceAnnual: 0,
        annualSavings: 0,
        trialDays: 14,            // 14-day free trial of Solo features
        description: 'Everything you need to get started and test Capita.',
        ai: {
            queriesPerMonth: 25,
            tokensPerMonth: 50_000,
            features: ['Basic business Q&A', 'Revenue & expense queries', 'Invoice status lookups'],
        },
        limits: {
            invoices: 5,            // Per month
            customers: 15,
            products: 20,
            ai_token_limit: 50_000,
        },
        features: {
            pdf_invoices: true,
            email_invoices: true,
            auto_followup: true,
            gst_reports: true,
            reports: 'full',
            white_label: false,
            priority_support: false,
            weekly_summary: true,
            ai_strategic_brief: true,
            ai_deep_context: true,
            ai_cashflow_forecast: false,
        },
    },

    // ─── Solo ₹299/mo ────────────────────────────────────────────────────────
    solo: {
        name: 'Solo',
        label: '₹299/mo',
        badge: 'Most Popular',
        price: 299,
        priceAnnual: 2_990,          // ≈ 2 months free (₹598 savings)
        annualSavings: 598,
        trialDays: 0,
        description: 'For active freelancers who want to move fast and get paid.',
        ai: {
            queriesPerMonth: 150,
            tokensPerMonth: 300_000,
            features: [
                'All Free AI features',
                'Strategic CFO advice',
                'Cash runway analysis',
                'Revenue concentration risk',
                'Dormant client recovery',
                'Auto follow-up drafts',
            ],
        },
        limits: {
            invoices: Infinity,
            customers: Infinity,
            products: Infinity,
            ai_token_limit: 300_000,
        },
        features: {
            pdf_invoices: true,
            email_invoices: true,
            auto_followup: true,
            gst_reports: true,
            reports: 'full',
            white_label: false,
            priority_support: false,
            weekly_summary: true,
            ai_strategic_brief: true,
            ai_deep_context: true,
            ai_cashflow_forecast: false,
        },
    },

    // ─── Solo Pro ₹699/mo ────────────────────────────────────────────────────
    solo_pro: {
        name: 'Solo Pro',
        label: '₹699/mo',
        badge: 'Best Value',
        price: 699,
        priceAnnual: 6_990,          // ≈ 2 months free (₹1,398 savings)
        annualSavings: 1_398,
        trialDays: 0,
        description: 'For high-volume freelancers who want deep intelligence.',
        ai: {
            queriesPerMonth: 500,
            tokensPerMonth: 1_250_000,
            features: [
                'All Solo AI features',
                'Cash flow forecasting',
                'Client churn prediction',
                'Proactive risk alerts',
                'Collection letter drafts',
                'Settlement negotiation AI',
                'Priority AI response queue',
            ],
        },
        limits: {
            invoices: Infinity,
            customers: Infinity,
            products: Infinity,
            ai_token_limit: 1_250_000,
        },
        features: {
            pdf_invoices: true,
            email_invoices: true,
            auto_followup: true,
            gst_reports: true,
            reports: 'full',
            white_label: true,
            priority_support: true,
            weekly_summary: true,
            ai_strategic_brief: true,
            ai_deep_context: true,
            ai_cashflow_forecast: true,
        },
    },

    // ─── Enterprise / CA Pro (Custom) ────────────────────────────────────────
    enterprise: {
        name: 'Enterprise',
        label: 'Custom pricing',
        badge: null,
        price: null,
        priceAnnual: null,
        annualSavings: 0,
        trialDays: 0,
        description: 'White-label for CAs and agencies managing multiple clients.',
        ai: {
            queriesPerMonth: Infinity,
            tokensPerMonth: Infinity,
            features: ['Unlimited AI queries', 'Custom model tuning', 'Dedicated support'],
        },
        limits: {
            invoices: Infinity,
            customers: Infinity,
            products: Infinity,
            ai_token_limit: Infinity,
        },
        features: {
            pdf_invoices: true,
            email_invoices: true,
            auto_followup: true,
            gst_reports: true,
            reports: 'custom',
            white_label: true,
            priority_support: true,
            weekly_summary: true,
            ai_strategic_brief: true,
            ai_deep_context: true,
            ai_cashflow_forecast: true,
        },
    },
};

// Alias: 'free' maps to 'starter' for consistent lookups
PLAN_TIERS.free = PLAN_TIERS.starter;

/**
 * Normalize tier key: handles common aliases
 */
const normalizeTierKey = (tier) => {
    if (!tier || tier === 'free') return 'starter';
    return tier;
};

/**
 * Get config for a specific tier. Falls back to 'starter' for unknown tiers.
 */
export const getTierConfig = (tier) => {
    return PLAN_TIERS[normalizeTierKey(tier)] || PLAN_TIERS.starter;
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
