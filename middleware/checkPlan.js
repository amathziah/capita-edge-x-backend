import { supabase } from '../supabase.js';
import { APIError } from './errorHandler.js';
import { getTierLimit } from '../config/tierConfig.js';

export const checkPlanLimits = async (req, res, next) => {
    const organizationId = req.user?.organizationId;
    const planOrgId = req.user?.isActingAsCA
        ? req.user.caOrganizationId
        : organizationId;

    // Skip check for provisioning or if user context isn't fully established yet
    if (req.path.endsWith('/provision') || !organizationId) {
        return next();
    }

    try {
        // 1. Get Organization Plan Tier
        const { data: org, error } = await supabase
            .from('organizations')
            .select('plan_tier')
            .eq('id', planOrgId)
            .single();

        if (error || !org) {
            console.error('Plan Check Error:', error);
            throw new APIError('Could not verify subscription plan', 500);
        }

        const tier = org.plan_tier || 'starter';

        // 2. Check AI request daily limits
        if (req.originalUrl.startsWith('/api/ai/')) {
            const dailyLimit = getTierLimit(tier, 'ai_requests_per_day');

            if (dailyLimit !== Infinity) {
                const today = new Date().toISOString().split('T')[0];
                const { count, error: usageError } = await supabase
                    .from('ai_requests')
                    .select('*', { count: 'exact', head: true })
                    .eq('organization_id', organizationId)
                    .gte('created_at', today);

                if (usageError) console.error('AI Usage Check Error', usageError);

                if (count >= dailyLimit) {
                    return res.status(429).json({
                        error: 'Daily AI Limit Reached',
                        message: `Your ${org.plan_tier} plan allows ${dailyLimit} AI requests per day. Upgrade for more.`,
                        code: 'AI_LIMIT_REACHED'
                    });
                }
            }
        }

        next();
    } catch (err) {
        next(err);
    }
};
