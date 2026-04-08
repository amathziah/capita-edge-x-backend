import crypto from 'crypto';
import { supabase } from '../../../core/database/supabase.js';

class AITraceService {
    createTraceId() {
        return crypto.randomUUID();
    }

    async log(entry = {}) {
        const payload = {
            trace_id: entry.traceId,
            organization_id: entry.organizationId,
            user_id: entry.userId || null,
            conversation_id: entry.conversationId || null,
            stage: entry.stage,
            tool_id: entry.toolId || null,
            query: entry.query || null,
            input: entry.input || {},
            output: entry.output || {}
        };

        try {
            const { error } = await supabase
                .from('ai_tool_traces')
                .insert([payload]);

            if (error) {
                console.warn('[AI Trace] insert skipped:', error.message || error);
            }
        } catch (error) {
            console.warn('[AI Trace] insert failed:', error?.message || error);
        }
    }

    async listByOrganization(organizationId, limit = 50) {
        try {
            const { data, error } = await supabase
                .from('ai_tool_traces')
                .select('*')
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) {
                console.warn('[AI Trace] list skipped:', error.message || error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.warn('[AI Trace] list failed:', error?.message || error);
            return [];
        }
    }

    async getTrace(traceId, organizationId) {
        try {
            const { data, error } = await supabase
                .from('ai_tool_traces')
                .select('*')
                .eq('trace_id', traceId)
                .eq('organization_id', organizationId)
                .order('created_at', { ascending: true });

            if (error) {
                console.warn('[AI Trace] get skipped:', error.message || error);
                return [];
            }
            return data || [];
        } catch (error) {
            console.warn('[AI Trace] get failed:', error?.message || error);
            return [];
        }
    }
}

export default new AITraceService();
