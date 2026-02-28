import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';
import { getTierConfig, getTierLimit, PLAN_TIERS } from '../config/tierConfig.js';

/**
 * Get the current plan status and usage for an organization.
 * Returns the tier, its config, and current usage vs limits.
 */
export const getPlanStatus = async (req, res) => {
    const organizationId = req.user.organizationId;

    try {
        // 1. Get Organization Plan Tier
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('plan_tier')
            .eq('id', organizationId)
            .single();

        if (orgError || !org) {
            throw new APIError('Could not find organization plan information', 404);
        }

        const tier = org.plan_tier || 'starter';
        const config = getTierConfig(tier);

        // 2. Get Invoice Count
        const { count: invoiceCount, error: invoiceError } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId);

        if (invoiceError) {
            console.error('Error fetching invoice count:', invoiceError);
        }

        // 3. Get AI Usage (Today)
        const today = new Date().toISOString().split('T')[0];
        const { count: aiRequestCount, error: aiError } = await supabase
            .from('ai_requests')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .gte('created_at', today);

        if (aiError) {
            console.error('Error fetching AI usage:', aiError);
        }

        res.json({
            plan_tier: tier,
            plan_name: config.name,
            plan_label: config.label,
            usage: {
                invoices: {
                    current: invoiceCount || 0,
                    limit: getTierLimit(tier, 'invoices'),
                },
                ai_requests: {
                    current: aiRequestCount || 0,
                    limit: getTierLimit(tier, 'ai_requests_per_day'),
                },
                products: {
                    limit: getTierLimit(tier, 'products'),
                },
                customers: {
                    limit: getTierLimit(tier, 'customers'),
                },
            },
            features: config.features,
        });

    } catch (err) {
        console.error('[PlanStatus Error]:', err);
        throw err;
    }
};

/**
 * Get all available tiers with their metadata (for pricing page).
 */
export const getAllTiers = async (req, res) => {
    const tiers = Object.entries(PLAN_TIERS).map(([slug, config]) => ({
        slug,
        name: config.name,
        label: config.label,
        price: config.price,
        priceAnnual: config.priceAnnual,
        pricePerClient: config.pricePerClient || null,
        description: config.description,
        limits: config.limits,
        features: config.features,
    }));

    res.json({ tiers });
};
