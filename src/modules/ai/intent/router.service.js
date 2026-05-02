import aiService from '../core/ai.service.js';
import { MODEL_FALLBACK_CHAIN } from '../infra/modelRouter.service.js';
import aiSkillRegistryService from '../skills/skillRegistry.service.js';

/**
 * AI Intent Router
 *
 * Single short LLM call (flash-lite) that classifies a user query into:
 *   - intent:        conversational | data_question | skill_invocation | unsupported
 *   - domain:        invoices | payments | expenses | compliance | customers | null
 *   - suggestedSkill: skillId from registry, or null
 *   - confidence:    0..1
 *
 * Replaces the keyword regex in guidedDesk._resolvePreferredDomain. The router
 * is cheap (one short JSON call, ~300 tokens) and decides whether to engage
 * the deliberative skills path or fall through to the existing tool loop.
 *
 * Falls back to a heuristic match if the model is unavailable so the system
 * never deadlocks on the router.
 */

const SUPPORTED_DOMAINS = ['invoices', 'payments', 'expenses', 'compliance', 'customers'];

class AIIntentRouterService {
    constructor() {
        this.runtime = aiService.runtimeService;
    }

    _buildPrompt(query, context = {}) {
        const skills = aiSkillRegistryService.listSkills().map(s =>
            `- ${s.id}: ${s.trigger}`
        ).join('\n');

        const recentDomain = context.session?.metadata?.currentDomain || 'none';
        const recentMessages = (context.history || []).slice(-3).map(m =>
            `${m.role}: ${String(m.content || m.text || '').slice(0, 120)}`
        ).join('\n') || 'none';

        return `You are an intent router for a finance assistant. Classify the user query.

Available domains: invoices, payments, expenses, compliance, customers
Available skills (multi-step playbooks):
${skills}

Recent conversation:
${recentMessages}
Active domain: ${recentDomain}

Query: ${JSON.stringify(query)}

Decide:
1. intent — one of:
   - "conversational" : greeting, "what can you do", general chit-chat, definitional ("what is GST")
   - "data_question" : tasks involving single actions like creating an invoice, drafting a customer, or asking about data. This uses function calling.
   - "skill_invocation" : matches a skill trigger above (complex multi-step workflows like "chasing overdue payments" or "closing the month").
   - "unsupported" : finance-adjacent but outside the five domains
2. domain — one of [invoices, payments, expenses, compliance, customers] or null
3. suggestedSkill — exact skill id from the list above, or null
4. confidence — 0.0–1.0

Reply with ONLY a JSON object, no markdown, no commentary:
{"intent":"...","domain":"...|null","suggestedSkill":"...|null","confidence":0.0,"reasoning":"<8 words>"}`;
    }

    _heuristicFallback(query) {
        const q = String(query || '').toLowerCase();
        let domain = null;
        if (/invoice|overdue|receivable|collection|owes/.test(q)) domain = 'invoices';
        else if (/payment|received|cash in|receipt/.test(q)) domain = 'payments';
        else if (/expense|spend|cost|vendor|bill/.test(q)) domain = 'expenses';
        else if (/compliance|gst|tds|tax|filing|deadline/.test(q)) domain = 'compliance';
        else if (/customer|client|churn/.test(q)) domain = 'customers';

        const isShort = q.split(/\s+/).length <= 4;
        const isGreeting = /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay)\b/.test(q);
        const isHelp = /what can you do|capabilit|help me|how (do|can) you/.test(q);

        let intent = 'data_question';
        if (isGreeting || isHelp || (isShort && !domain)) intent = 'conversational';
        if (!domain && !isHelp && !isGreeting) intent = 'unsupported';

        return {
            intent,
            domain,
            suggestedSkill: null,
            confidence: 0.4,
            reasoning: 'heuristic_fallback',
            source: 'heuristic'
        };
    }

    _parseModelJson(text) {
        if (!text) return null;
        try {
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            const obj = JSON.parse(cleaned);
            return obj;
        } catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            try { return JSON.parse(match[0]); } catch { return null; }
        }
    }

    async classify(query, context = {}) {
        if (!query || !String(query).trim()) {
            return { intent: 'conversational', domain: null, suggestedSkill: null, confidence: 0.9, reasoning: 'empty', source: 'shortcut' };
        }

        if (!this.runtime?.hasModelClient() || this.runtime.isCircuitOpen()) {
            return this._heuristicFallback(query);
        }

        const prompt = this._buildPrompt(query, context);
        const fallbackChain = ['gemini-2.5-flash-lite', ...MODEL_FALLBACK_CHAIN.filter(m => m !== 'gemini-2.5-flash-lite')];

        for (const modelName of fallbackChain) {
            try {
                const model = this.runtime.getModel(modelName, true);
                if (!model) continue;
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                });
                const text = result?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
                const parsed = this._parseModelJson(text);
                if (!parsed) continue;

                const domain = SUPPORTED_DOMAINS.includes(parsed.domain) ? parsed.domain : null;
                const skillId = parsed.suggestedSkill && aiSkillRegistryService.getSkill(parsed.suggestedSkill)
                    ? parsed.suggestedSkill : null;
                const intent = ['conversational', 'data_question', 'skill_invocation', 'unsupported'].includes(parsed.intent)
                    ? parsed.intent : 'data_question';
                const confidence = Number(parsed.confidence);

                return {
                    intent,
                    domain,
                    suggestedSkill: skillId,
                    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
                    reasoning: String(parsed.reasoning || '').slice(0, 80),
                    source: `model:${modelName}`
                };
            } catch (err) {
                if (this.runtime.isRetryable(err)) continue;
                break;
            }
        }

        return this._heuristicFallback(query);
    }
}

export default new AIIntentRouterService();
