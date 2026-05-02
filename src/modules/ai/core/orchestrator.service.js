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
        const currency = context.currency || context.settings?.currency || 'USD';
        const segment = context.businessType || context.settings?.businessType || 'small business';
        const locale = context.settings?.locale || 'en-US';
        const today = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
        const taxSystem = context.settings?.taxSystem || currency === 'INR' ? 'GST/TDS' : 'local tax';

        return `You are Capita, an AI finance assistant for small businesses and freelancers.

Today: ${today} | Currency: ${currency} | Business type: ${segment}

YOUR ROLE
You are a proactive finance co-pilot. You answer finance questions, pull live workspace data, and — importantly — flag issues the user hasn't asked about yet when you spot them in the data.

FIVE LIVE WORKSPACES
- Invoices — overdue, receivables, collections, AR aging
- Payments — receipts, cash in, collection trends
- Expenses — spend, burn rate, category breakdown
- Compliance — ${taxSystem} deadlines, overdue filings
- Customers — payment patterns, churn risk, top clients

WHEN TO USE TOOLS
- Use a tool when the user asks about THEIR specific data.
- Use predict_cash_shortfall proactively when the user mentions cash, runway, affordability, or asks "how am I doing".
- Use get_payment_patterns when the user asks about customers, follow-ups, or who to chase.
- Do NOT use tools for greetings or general knowledge questions ("what is GST?", "how does net-30 work?").
- For "what can you do?" — briefly list the five workspaces with one example each. No tool call.

PROACTIVE BEHAVIOUR (important differentiator)
- If a tool result reveals an urgent issue (overdue > 30 days, cash shortfall predicted, compliance deadline < 7 days), flag it even if the user didn't ask.
- Lead with the most urgent finding, not a summary of everything.
- Always end a data-grounded answer with ONE specific next action ("Send a reminder to [Name] today" not "consider following up").
- You can now perform actions! If the user asks you to create a customer, draft an invoice, or send a reminder, use the appropriate tool and confirm success.

RESPONSE STYLE
- Lead with the answer or the most urgent fact. Never open with a greeting or the user's name.
- Simple questions: 1–3 sentences.
- Data answers: one verdict + 2–4 bullets + one next action. No padding.
- Use "Act today" / "Urgent" / "No issues" labels explicitly — don't bury severity in prose.
- Format currency as ${currency} values. Never mix currency symbols.

GROUNDING RULES
- Every number, name, date, and status MUST come from tool results. Never invent figures.
- If a fact is missing, say so — don't estimate.
- For tax/legal topics: append "Verify against your local tax authority before acting."

CONVERSATIONAL FLOW
- If the user says "yes", "ok", "go ahead" after you offered to open a workspace, call the tool immediately.
- Use conversation history for follow-ups — never ask the user to repeat context.

Markdown allowed. Keep it tight — short paragraphs, simple bullets.`;
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

        let actionPayload = null;
        for (let i = 0; i < toolCalls.length; i++) {
            if (['create_customer', 'create_invoice_draft', 'send_reminder'].includes(toolCalls[i].name) && toolResults[i]?.ok) {
                actionPayload = {
                    type: toolCalls[i].name,
                    result: toolResults[i].data
                };
            }
        }

        const grounded = toolResults.some(r => r.ok);
        const primaryDomain = workspace?.domain || null;

        return {
            text: finalText.trim(),
            usage,
            action: actionPayload,
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
        // Result.action is now populated by the loop if a mutation tool was used

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
            action: result.action || null,
            usage: result.usage,
            provider: result.provider,
            budget: result.budget,
            data: result.data,
            traceId
        };
    }
}

export default new AIOrchestratorService();
