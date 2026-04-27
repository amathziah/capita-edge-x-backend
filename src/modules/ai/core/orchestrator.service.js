import aiToolRegistryService from '../workspace/toolRegistry.service.js';
import aiGuidedDeskService from '../workspace/guidedDesk.service.js';
import aiTraceService from '../infra/trace.service.js';
import aiCachingService from '../infra/cache.service.js';
import aiSessionManagerService from '../agent/session.service.js';
import aiService from './ai.service.js';
import aiModelRouterService, { MODEL_FALLBACK_CHAIN } from '../infra/modelRouter.service.js';

/**
 * AI Orchestrator — agentic tool-use loop.
 *
 * Single path: build system prompt → call Gemini with tools → if model returns
 * functionCall, run tool, feed result back, loop (up to MAX_TOOL_TURNS) → emit
 * the final text answer. No regex intent classifiers. No static greeting paths.
 * The LLM decides when to use tools and when to just talk.
 */

const MAX_TOOL_TURNS = 3;
const SUPPORTED_DOMAINS = ['invoices', 'payments', 'expenses', 'compliance', 'customers'];

class AIOrchestratorService {
    constructor() {
        this.toolRegistry = aiToolRegistryService;
        this.runtime = aiService.runtimeService;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // System prompt — single source of truth
    // ─────────────────────────────────────────────────────────────────────────

    buildSystemPrompt(context = {}) {
        const currency = context.currency || context.settings?.currency || 'INR';
        const segment = context.businessType || context.settings?.businessType || 'solopreneur';
        const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

        return `You are Capita, an AI finance assistant for Indian small businesses and freelancers.

Today's date: ${today}
Currency: ${currency}
Business segment: ${segment}

YOUR ROLE
You answer finance questions and pull live workspace data when needed. You have four live workspaces:
- Invoices (overdue, receivables, collections)
- Payments (receipts, money in)
- Expenses (spend, burn rate)
- Compliance (GST, TDS, deadlines)

WHEN TO USE TOOLS
- Use a tool ONLY when the user asks about THEIR specific data (their invoices, their payments, etc.).
- Do NOT use tools for greetings, thanks, acknowledgments, or general finance questions ("what is GST?", "how does net-30 work?").
- For general knowledge questions, answer directly from your training — be concise and practical.
- For "what can you do?" — list the four workspaces with one example question each. Do not call tools.

RESPONSE STYLE
- Lead with the answer. No name-greetings. Never open with the user's or business's name.
- Simple/general questions: 1–3 sentences. Do not elaborate unless asked.
- Data-grounded answers: one verdict sentence + 2–4 bullets + one specific next step. No padding.
- Plain language. No jargon, no hedging, no filler.
- If urgent, say "Urgent" or "Act today". If healthy, say "No immediate issues".

GROUNDING RULES (when you have used a tool)
- Every number, name, date, and status MUST come from the tool result. Never invent or estimate business figures.
- If a fact is missing from tool data, say so — don't guess.
- For GST/TDS/tax/legal: append "Verify against the latest official source before acting."

CONVERSATIONAL FLOW
- If the user acknowledges (yes, sure, ok, go ahead) and you previously offered to open a workspace, call the matching tool now.
- If a follow-up references a previous answer, use the conversation history — don't ask the user to repeat.

Markdown is allowed. Keep it minimal — short paragraphs, simple bullets.`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    _historyToGeminiContents(history = []) {
        return history
            .filter(m => m && (m.content || m.text) && m.role)
            .map(m => ({
                role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
                parts: [{ text: String(m.content || m.text).slice(0, 4000) }]
            }));
    }

    _extractTextFromResponse(response) {
        try {
            const candidates = response?.candidates || [];
            for (const c of candidates) {
                const parts = c?.content?.parts || [];
                const text = parts.map(p => p.text).filter(Boolean).join('').trim();
                if (text) return text;
            }
            return '';
        } catch {
            return '';
        }
    }

    _extractFunctionCalls(response) {
        const calls = [];
        try {
            const candidates = response?.candidates || [];
            for (const c of candidates) {
                const parts = c?.content?.parts || [];
                for (const p of parts) {
                    if (p.functionCall) {
                        calls.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
                    }
                }
            }
        } catch { /* ignore */ }
        return calls;
    }

    async _runTool(toolName, args, context, traceId) {
        const start = Date.now();
        try {
            const result = await this.toolRegistry.executeTool(toolName, context, args || {});

            aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'tool',
                toolId: toolName,
                input: { args: args || {} },
                output: { meta: result?.meta || {}, durationMs: Date.now() - start }
            }).catch(() => {});

            return { ok: true, data: result?.data || null, meta: result?.meta || null };
        } catch (err) {
            aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                stage: 'error',
                toolId: toolName,
                input: { args: args || {} },
                output: { error: err.message }
            }).catch(() => {});

            return { ok: false, error: err.message };
        }
    }

    _findFirstUiTool(toolCalls = [], toolResults = []) {
        for (let i = 0; i < toolCalls.length; i++) {
            const uiComponent = this.toolRegistry.getUiComponent(toolCalls[i].name);
            if (uiComponent && toolResults[i]?.ok) {
                return {
                    component: uiComponent,
                    domain: uiComponent.replace('ai_domain_', ''),
                    data: toolResults[i].data || {},
                    meta: toolResults[i].meta || {}
                };
            }
        }
        return null;
    }

    async _enrichWorkspace(workspace, organizationId) {
        if (!workspace || !SUPPORTED_DOMAINS.includes(workspace.domain)) return workspace;
        try {
            const ws = await aiGuidedDeskService.getWorkspace(workspace.domain, organizationId, 'overview');
            return {
                component: workspace.component,
                domain: workspace.domain,
                label: ws?.label,
                specialistLabel: ws?.specialistLabel,
                selectedView: 'overview',
                availableViews: ws?.availableViews,
                data: ws?.data,
                meta: ws?.meta
            };
        } catch (err) {
            console.error('[Orchestrator] Workspace enrich failed:', err.message);
            return workspace;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core agentic loop
    // ─────────────────────────────────────────────────────────────────────────

    async _runAgenticLoop(query, context, { traceId } = {}) {
        const orgId = context.organizationId;
        const userId = context.user?.id || 'anon';

        // Budget + circuit checks
        const budget = await aiService._checkPlanBudget(orgId);
        if (!budget.allowed) {
            throw new Error('AI access is temporarily unavailable. Upgrade or wait for the next usage cycle.');
        }
        if (!this.runtime.hasModelClient() || this.runtime.isCircuitOpen() || !this.runtime.canMakeRequest()) {
            throw new Error('AI engine is in cooldown. Please try again in 60s.');
        }

        const tier = budget.tier || 'starter';
        const complexity = aiModelRouterService.detectComplexity(query, 0);
        const selected = aiModelRouterService.selectModel(complexity, tier);
        const fallbackChain = [selected.name, ...MODEL_FALLBACK_CHAIN.filter(m => m !== selected.name)];

        const systemInstruction = this.buildSystemPrompt(context);
        const tools = this.toolRegistry.getGeminiFunctionDeclarations();
        const history = this._historyToGeminiContents(context.history || []);

        const contents = [...history, { role: 'user', parts: [{ text: query }] }];

        const toolCalls = [];
        const toolResults = [];
        let finalText = '';
        let usage = null;
        let providerModel = null;

        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            this.runtime.consumeToken();

            let response = null;
            for (const modelName of fallbackChain) {
                try {
                    const model = this.runtime.getModelWithTools(modelName, {
                        tools,
                        systemInstruction,
                        maxOutputTokens: 1200,
                        temperature: 0.4
                    });
                    if (!model) continue;

                    const result = await model.generateContent({ contents });
                    response = result.response;
                    providerModel = modelName;
                    if (response?.usageMetadata) usage = response.usageMetadata;
                    break;
                } catch (err) {
                    if (this.runtime.isRetryable(err)) continue;
                    throw err;
                }
            }
            if (!response) throw new Error('No model available.');

            const calls = this._extractFunctionCalls(response);
            const text = this._extractTextFromResponse(response);

            if (calls.length === 0) {
                finalText = text;
                break;
            }

            // Append model turn (function calls) to contents
            contents.push({
                role: 'model',
                parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args } }))
            });

            const settled = await Promise.all(calls.map(c => this._runTool(c.name, c.args, context, traceId)));
            calls.forEach((c, i) => { toolCalls.push(c); toolResults.push(settled[i]); });

            // Append function responses
            contents.push({
                role: 'user',
                parts: settled.map((r, i) => ({
                    functionResponse: {
                        name: calls[i].name,
                        response: r.ok ? { data: r.data, meta: r.meta } : { error: r.error }
                    }
                }))
            });
        }

        // If we exhausted tool turns without final text, force one final text-only call
        if (!finalText) {
            for (const modelName of fallbackChain) {
                try {
                    const model = this.runtime.getModelWithTools(modelName, {
                        systemInstruction,
                        maxOutputTokens: 1200,
                        temperature: 0.4
                    });
                    if (!model) continue;
                    const result = await model.generateContent({ contents });
                    finalText = this._extractTextFromResponse(result.response) || 'I could not produce a complete answer.';
                    if (result.response?.usageMetadata) usage = result.response.usageMetadata;
                    providerModel = modelName;
                    break;
                } catch (err) {
                    if (this.runtime.isRetryable(err)) continue;
                    throw err;
                }
            }
        }

        let workspace = this._findFirstUiTool(toolCalls, toolResults);
        if (workspace) {
            workspace = await this._enrichWorkspace(workspace, orgId);
        }

        const grounded = toolResults.some(r => r.ok);
        const primaryDomain = workspace?.domain || null;

        return {
            text: finalText.trim(),
            usage,
            provider: `gemini:${providerModel || 'unknown'}`,
            data: {
                type: workspace ? 'workspace_view' : (grounded ? 'grounded_answer' : 'general'),
                workspace,
                confidence: grounded ? 'grounded' : 'general',
                grounded,
                domain: primaryDomain,
                toolsUsed: toolCalls.map(c => c.name),
                provenance: toolCalls.map(c => ({ tool: c.name }))
            },
            budget: await aiService.getBudgetStatus(userId, orgId)
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    async processQuery(query, context = {}) {
        const traceId = aiTraceService.createTraceId();

        const session = await aiSessionManagerService.getOrCreateSession(
            context.organizationId, context.user?.id, context.conversationId
        );

        const cached = await aiCachingService.get('chat', context.organizationId, query);
        if (cached && !context.skipCache) {
            cached.data.traceId = traceId;
            return cached.data;
        }

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query },
            output: {}
        });

        const result = await this._runAgenticLoop(query, context, { traceId });
        result.traceId = traceId;
        result.action = null;

        aiSessionManagerService.addMessage(session, { role: 'user', content: query });
        aiSessionManagerService.addMessage(session, {
            role: 'assistant',
            content: result.text,
            domain: result.data?.domain
        });

        await aiCachingService.set('chat', context.organizationId, query, result, { persist: true });
        return result;
    }

    async *processQueryStream(query, context = {}) {
        const traceId = aiTraceService.createTraceId();

        const session = await aiSessionManagerService.getOrCreateSession(
            context.organizationId, context.user?.id, context.conversationId
        );

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query },
            output: {}
        });

        const result = await this._runAgenticLoop(query, context, { traceId });

        aiSessionManagerService.addMessage(session, { role: 'user', content: query });
        aiSessionManagerService.addMessage(session, {
            role: 'assistant',
            content: result.text,
            domain: result.data?.domain
        });

        yield {
            type: 'complete',
            text: result.text,
            action: null,
            usage: result.usage,
            provider: result.provider,
            budget: result.budget,
            data: result.data,
            traceId
        };
    }
}

export default new AIOrchestratorService();
