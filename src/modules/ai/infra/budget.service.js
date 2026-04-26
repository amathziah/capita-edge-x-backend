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
        const models = this.tierModels['starter'] || this.fallbackModels;
        return { allowed: true, limit: Infinity, used: 0, tier: 'starter', models };
    }

    async getBudgetStatus(userId, orgId) {
        return { userUsed: 0, userMax: Infinity, userRemaining: Infinity, tier: 'starter', isExhausted: false };
    }
}

export default AIBudgetService;
