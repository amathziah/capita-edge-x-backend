import { supabase } from '../../../core/database/supabase.js';
import { PLAN_TIERS } from '../../../core/config/tierConfig.js';

class AIBudgetService {
    constructor({ tierModels = {}, fallbackModels = [] } = {}) {
        this.tierModels = tierModels;
        this.fallbackModels = fallbackModels;
    }

    normalizeTierKey(key) {
        if (!key || key === 'free') return 'starter';
        return key;
    }

    async countMonthlyUsageRecords(orgId, firstOfMonthIso) {
        const timestampColumns = ['createdAt', 'created_at'];

        for (const column of timestampColumns) {
            const { count, error } = await supabase
                .from('ai_requests')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .gte(column, firstOfMonthIso);

            if (!error) {
                return { count: count || 0, column };
            }
        }

        return { count: 0, column: null, error: new Error('Unable to resolve ai_requests timestamp column') };
    }

    async checkPlanBudget(orgId) {
        if (!orgId) return { allowed: true, limit: 999, used: 0 };

        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('plan_tier')
            .eq('id', orgId)
            .single();

        if (orgError) {
            console.error('Plan Budget Error (Org Lookup):', orgError);
        }

        const rawTier = org?.plan_tier || 'starter';
        const tierKey = this.normalizeTierKey(rawTier);
        const planConfig = PLAN_TIERS[tierKey] || PLAN_TIERS.starter;
        const queryLimit = planConfig.ai.queriesPerMonth;
        const models = this.tierModels[tierKey] || this.fallbackModels;

        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        firstOfMonth.setHours(0, 0, 0, 0);

        const usage = await this.countMonthlyUsageRecords(orgId, firstOfMonth.toISOString());
        if (usage.error) {
            console.error('Plan Budget Error (Usage Query):', usage.error);
            return { allowed: true, limit: queryLimit, used: 0 };
        }

        return {
            allowed: usage.count < queryLimit,
            used: usage.count,
            limit: queryLimit,
            tier: planConfig.name,
            models
        };
    }

    async getBudgetStatus(userId, orgId) {
        const budget = await this.checkPlanBudget(orgId);

        return {
            userUsed: budget.used,
            userMax: budget.limit,
            userRemaining: Math.max(0, budget.limit - budget.used),
            tier: budget.tier,
            isExhausted: !budget.allowed,
        };
    }
}

export default AIBudgetService;
