import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

/**
 * Get the current plan status and usage for an organization
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
            plan_tier: org.plan_tier,
            usage: {
                invoices: {
                    current: invoiceCount || 0,
                    limit: org.plan_tier === 'pro' ? Infinity : 5
                },
                ai_requests: {
                    current: aiRequestCount || 0,
                    limit: org.plan_tier === 'pro' ? Infinity : 50
                }
            }
        });

    } catch (err) {
        console.error('[PlanStatus Error]:', err);
        throw err;
    }
};
