import { supabase } from '../supabase.js';
import { APIError } from './errorHandler.js';

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
        // 1. Get Organization Plan
        const { data: org, error } = await supabase
            .from('organizations')
            .select('plan_tier')
            .eq('id', planOrgId)
            .single();

        if (error || !org) {
            console.error('Plan Check Error:', error);
            throw new APIError('Could not verify subscription plan', 500);
        }

        // 2. If Pro, allow everything
        if (org.plan_tier === 'pro') {
            return next();
        }

        // 3. If Free, check limits
        // Limit: Max 5 Invoices
        if (req.method === 'POST' && req.path === '/api/invoices') {
            const { count, error: countError } = await supabase
                .from('invoices')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId);

            if (countError) {
                console.error('Invoice Count Error:', countError);
                throw new APIError('Could not verify usage limits', 500);
            }

            if (count >= 5) {
                return res.status(403).json({
                    error: 'Limit Reached',
                    message: 'Free plan is limited to 5 invoices. Please upgrade to Pro for unlimited invoices.',
                    code: 'LIMIT_REACHED'
                });
            }
        }

        // Limit: Max 50 AI Requests per Day
        if (req.originalUrl.startsWith('/api/ai/')) {
            const today = new Date().toISOString().split('T')[0];
            const { count, error: usageError } = await supabase
                .from('ai_requests')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', organizationId)
                .gte('created_at', today);

            if (usageError) console.error('AI Usage Check Error', usageError);

            if (count >= 50) {
                return res.status(429).json({
                    error: 'Daily AI Limit Reached',
                    message: 'You have used your 50 daily AI requests. Please upgrade to Pro for unlimited AI.',
                    code: 'AI_LIMIT_REACHED'
                });
            }
        }

        next();
    } catch (err) {
        next(err);
    }
};
