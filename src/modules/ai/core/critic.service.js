import aiService from './ai.service.js';

/**
 * Critic / Verifier
 *
 * Cheap second LLM pass that checks whether the final assistant text is
 * grounded in the tool results actually returned this turn. Catches
 * hallucinated numbers, names, dates, and unsupported claims that the
 * grounding rules in the system prompt sometimes miss.
 *
 * Output: { ok, hallucinations[], confidence, suggested_revision? }
 *
 * Cheap by design — flash-lite, JSON mode, capped tokens. Falls open on
 * model failure (returns ok=true) so the critic never blocks the user.
 */

const CRITIC_MODEL = 'gemini-2.5-flash-lite';

class AICriticService {
    constructor() {
        this.runtime = aiService.runtimeService;
    }

    _summariseToolResults(toolCalls = [], toolResults = []) {
        const out = [];
        for (let i = 0; i < toolCalls.length; i++) {
            const r = toolResults[i];
            if (!r?.ok) continue;
            const summary = this._compactValue(r.data);
            out.push({ tool: toolCalls[i].name, data: summary });
        }
        return out;
    }

    _compactValue(value, depth = 0) {
        if (value == null) return null;
        if (depth > 3) return '[truncated]';
        if (typeof value !== 'object') return value;
        if (Array.isArray(value)) {
            return value.slice(0, 10).map(v => this._compactValue(v, depth + 1));
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = this._compactValue(v, depth + 1);
        }
        return out;
    }

    async verify({ query, finalText, toolCalls, toolResults }) {
        if (!finalText || !this.runtime?.hasModelClient() || this.runtime.isCircuitOpen()) {
            return { ok: true, skipped: true };
        }

        const grounded = (toolCalls || []).length > 0;
        if (!grounded) {
            // Conversational response — nothing to verify against.
            return { ok: true, skipped: true, reason: 'no_tool_calls' };
        }

        const evidence = this._summariseToolResults(toolCalls, toolResults);
        if (evidence.length === 0) return { ok: true, skipped: true, reason: 'no_successful_tools' };

        const prompt = `You verify whether an assistant answer is grounded in tool results.

User asked: ${JSON.stringify(query)}

Assistant answered:
"""
${finalText}
"""

Tool results available:
${JSON.stringify(evidence, null, 2)}

Check ONLY for:
1. Numbers / amounts / counts that do NOT appear in the tool results.
2. Customer / invoice / vendor names that do NOT appear in the tool results.
3. Dates / deadlines that do NOT appear in the tool results.
4. Definitive claims about THE USER'S DATA that the tool results do not support.

Generic finance advice ("net-30 means…"), tone, and recommendations are FINE.
Mention of dates from the user query itself is FINE.

Reply with ONLY a JSON object:
{"ok":true|false,"hallucinations":["..."],"confidence":0.0}

ok=false only if you find a concrete unsupported number/name/date.`;

        try {
            const model = this.runtime.getModel(CRITIC_MODEL, true);
            if (!model) return { ok: true, skipped: true, reason: 'model_unavailable' };

            const res = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });
            const text = res?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
            const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            const match = cleaned.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : cleaned);

            return {
                ok: parsed.ok !== false,
                hallucinations: Array.isArray(parsed.hallucinations) ? parsed.hallucinations.slice(0, 5) : [],
                confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5,
                skipped: false
            };
        } catch {
            return { ok: true, skipped: true, reason: 'critic_error' };
        }
    }
}

export default new AICriticService();
