import { supabase } from '../../core/database/supabase.js';
import aiService from './ai.service.js';
import { LIMITS } from '../../core/config/constants.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import { AI_PRICING, EXCHANGE_RATE } from '../../core/config/tierConfig.js';

export const insightsCache = new Map();
export const CACHE_TTL = LIMITS.AI_CACHE_TTL_MS;
export const AI_ACCESS_EXHAUSTED_MESSAGE = 'AI access is temporarily unavailable for this workspace right now. Upgrade or wait for the next usage cycle to continue.';

export const calculateAICost = (usage, model = 'gemini-2.0-flash') => {
    if (!usage) return { tokens: 0, cost: 0 };

    const pricing = AI_PRICING[model] || AI_PRICING['gemini-2.5-flash'] || AI_PRICING['gemini-2.0-flash'];
    const { promptTokenCount = 0, candidatesTokenCount = 0, totalTokenCount = 0 } = usage;

    const usdCost = (promptTokenCount * pricing.inputPer1M / 1000000) +
                    (candidatesTokenCount * pricing.outputPer1M / 1000000);

    return {
        tokens: totalTokenCount,
        cost: usdCost * EXCHANGE_RATE.USD_TO_INR
    };
};

export const getAIUsageData = async (organizationId) => {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const timestampColumns = ['createdAt', 'created_at'];
    for (const column of timestampColumns) {
        const { data, error } = await supabase
            .from('ai_requests')
            .select('id, total_tokens')
            .eq('organization_id', organizationId)
            .gte(column, firstOfMonth.toISOString());

        if (!error) {
            return {
                queries: (data || []).length,
                tokens: (data || []).reduce((sum, req) => sum + (req.total_tokens || 0), 0)
            };
        }
    }

    return { queries: 0, tokens: 0 };
};

export const checkAICreditLimit = async (req) => {
    const budget = await aiService.getBudgetStatus(req.user.id, req.user.organizationId);

    return {
        allowed: !budget.isExhausted,
        limit: budget.userMax,
        usage: budget.userUsed
    };
};

export const getOrganizationSettings = async (organizationId) => {
    const { data: config, error } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    const mapped = mapConfigToFrontend(config || {});

    return {
        raw: config || {},
        mapped,
        currency: mapped?.currency || 'INR',
        planTier: config?.plan_tier || mapped?.plan_tier || 'starter',
        businessType: mapped?.businessType || mapped?.business_type || 'solopreneur'
    };
};

export const getAIContext = async (req, persona, agentId, history) => {
    let orgSettings = {
        raw: {},
        mapped: {},
        currency: 'INR',
        planTier: req.user?.plan_tier || 'starter',
        businessType: 'solopreneur'
    };

    try {
        orgSettings = await getOrganizationSettings(req.user.organizationId);
    } catch (err) {
        console.error('AI Context Error (Settings):', err);
    }

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

    const currency = orgSettings.currency;
    const planTier = orgSettings.planTier || req.user?.plan_tier || 'starter';
    const businessType = persona || orgSettings.businessType || 'solopreneur';

    return {
        user: req.user,
        organizationId: req.user.organizationId,
        currency,
        planTier,
        businessType,
        temporal: {
            currentTime: now.toISOString(),
            currentDay: dayOfWeek,
            fiscalYear: now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`
        },
        settings: orgSettings.mapped,
        history: history || [],
        agentId,
        conversationId: req.body?.conversationId || null,
        query: req.body?.query || null,
        invoices: [],
        customers: [],
        expenses: [],
        payments: [],
        stats: {},
        safeToSpend: {},
        ageing: {},
        growth: {},
        deepContext: {},
        customerInsights: [],
        personaStats: {},
        revenueTrends: []
    };
};
