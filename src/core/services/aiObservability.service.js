import crypto from 'crypto';
import { supabase } from '../database/supabase.js';

class AIObservabilityService {
    constructor() {
        this.enabled = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY;
        this.traceEnabled = process.env.AI_TRACE_ENABLED === 'true';
    }

    generateTraceId() {
        return `trace_${crypto.randomBytes(8).toString('hex')}`;
    }

    async logRequest(params) {
        if (!this.traceEnabled) return null;
        
        const traceId = this.generateTraceId();
        const {
            organizationId,
            userId,
            prompt,
            model,
            intent,
            domain,
            toolResults,
            response,
            latencyMs,
            cost,
            tokens
        } = params;

        const record = {
            trace_id: traceId,
            organization_id: organizationId,
            user_id: userId,
            prompt: prompt?.slice(0, 1000),
            model,
            intent,
            domain,
            tool_count: toolResults?.length || 0,
            response_latency_ms: latencyMs,
            prompt_tokens: tokens?.prompt,
            completion_tokens: tokens?.completion,
            total_tokens: tokens?.total,
            cost_in_usd: cost,
            created_at: new Date().toISOString()
        };

        try {
            await supabase.from('ai_traces').insert(record);
        } catch (err) {
            console.error('[Observability] Failed to log trace:', err.message);
        }

        return traceId;
    }

    async logError(params) {
        const { traceId, organizationId, error, stage } = params;
        
        try {
            await supabase.from('ai_errors').insert({
                trace_id: traceId,
                organization_id: organizationId,
                error_message: error,
                stage,
                created_at: new Date().toISOString()
            });
        } catch (err) {
            console.error('[Observability] Failed to log error:', err.message);
        }
    }

    async getTraces(organizationId, limit = 50) {
        const { data, error } = await supabase
            .from('ai_traces')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false })
            .limit(limit);

        return error ? [] : data;
    }

    async getTrace(traceId) {
        const { data, error } = await supabase
            .from('ai_traces')
            .select('*')
            .eq('trace_id', traceId)
            .single();

        return error ? null : data;
    }

    async getUsageStats(organizationId, days = 30) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        const { data, error } = await supabase
            .from('ai_traces')
            .select('intent, domain, model, total_tokens, cost_in_usd, created_at')
            .eq('organization_id', organizationId)
            .gte('created_at', startDate.toISOString());

        if (error) return null;

        const stats = {
            totalRequests: data.length,
            totalTokens: data.reduce((sum, r) => sum + (r.total_tokens || 0), 0),
            totalCost: data.reduce((sum, r) => sum + (r.cost_in_usd || 0), 0),
            byIntent: {},
            byDomain: {}
        };

        for (const row of data) {
            stats.byIntent[row.intent] = (stats.byIntent[row.intent] || 0) + 1;
            stats.byDomain[row.domain] = (stats.byDomain[row.domain] || 0) + 1;
        }

        return stats;
    }
}

export default new AIObservabilityService();