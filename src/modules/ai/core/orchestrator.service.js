import aiToolRegistryService from '../workspace/toolRegistry.service.js';
import aiGuidedDeskService from '../workspace/guidedDesk.service.js';
import aiTraceService from '../infra/trace.service.js';
import aiCachingService from '../infra/cache.service.js';
import aiSessionManagerService from '../agent/session.service.js';
import aiService from './ai.service.js';
import aiModelRouterService, { MODEL_FALLBACK_CHAIN } from '../infra/modelRouter.service.js';
import aiIntentRouterService from '../intent/router.service.js';
import aiSkillRegistryService from '../skills/skillRegistry.service.js';
import aiCriticService from './critic.service.js';

/**
 * AI Orchestrator — agentic with intent router, skills, and critic.
 *
 *   1. Intent router classifies the query (LLM, cheap).
 *   2. If skill_invocation → planner runs the skill (deterministic + LLM mix)
 *      and returns a plan with results, drafts, and approval gates surfaced
 *      to the frontend.
 *   3. Otherwise → existing Gemini tool-use loop pulls live data.
 *   4. Critic verifies the final text against tool evidence before returning.
 */

const MAX_TOOL_TURNS = 8;
const SUPPORTED_DOMAINS = ['invoices', 'payments', 'expenses', 'compliance', 'customers'];
const SKILL_CONFIDENCE_THRESHOLD = 0.7;

class AIOrchestratorService {
    constructor() {
        this.toolRegistry = aiToolRegistryService;
        this.runtime = aiService.runtimeService;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // System prompt
    // ─────────────────────────────────────────────────────────────────────────

    buildSystemPrompt(context = {}) {
        const currency = context.currency || context.settings?.currency || 'USD';
        const segment = context.businessType || context.settings?.businessType || 'small business';
        const locale = context.settings?.locale || 'en-US';
        const today = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
        const taxSystem = context.settings?.taxSystem || (currency === 'INR' ? 'GST/TDS' : 'local tax');

        const skillSummary = aiSkillRegistryService.listSkills()
            .map(s => `  - ${s.id}: ${s.label}`)
            .join('\n');

        return `You are Capita, an AI finance agent for small businesses and freelancers.

Today: ${today} | Currency: ${currency} | Business type: ${segment}

YOUR ROLE
You are a deliberative finance co-pilot. You answer finance questions, pull live workspace data, run multi-step skills (playbooks), and proactively flag issues the user hasn't asked about yet when you spot them in the data.

FIVE LIVE WORKSPACES
- Invoices — overdue, receivables, collections, AR aging
- Payments — receipts, cash in, collection trends
- Expenses — spend, burn rate, category breakdown
- Compliance — ${taxSystem} deadlines, overdue filings
- Customers — payment patterns, churn risk, top clients

AVAILABLE SKILLS (you can suggest these by name when appropriate)
${skillSummary || '  (none registered)'}

WHEN TO USE TOOLS
- Use a tool whenever the user asks about THEIR specific data.
- Use predict_cash_shortfall proactively when the user mentions cash, runway, affordability, or asks "how am I doing".
- Use get_payment_patterns when the user asks about customers, follow-ups, or who to chase.
- Do NOT use tools for greetings or general definitional questions ("what is GST?").

PROACTIVE BEHAVIOUR (the differentiator)
- If a tool result reveals an urgent issue (overdue > 30 days, cash shortfall predicted, compliance deadline < 7 days), flag it even if the user didn't ask.
- Lead with the most urgent finding, not a summary.
- Always end a data-grounded answer with ONE specific next action ("Send a reminder to <Name> today" not "consider following up").
- When a multi-step workflow would help (chasing many invoices, monthly close, cash response), recommend the relevant skill by name.

RESPONSE STYLE
- Lead with the answer or the most urgent fact. Never open with a greeting or the user's name.
- Simple questions: 1–3 sentences.
- Data answers: one verdict + 2–4 bullets + one next action. No padding.
- Use "Act today" / "Urgent" / "No issues" labels explicitly — don't bury severity in prose.
- Format currency as ${currency} values. Never mix currency symbols.

GROUNDING RULES (a verifier checks every answer)
- Every number, name, date, and status MUST come from tool results. Never invent figures.
- If a fact is missing, say so — don't estimate.
- For tax/legal topics: append "Verify against your local tax authority before acting."

Markdown allowed. Keep it tight.`;
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
        } catch { return ''; }
    }

    _extractFunctionCalls(response) {
        const calls = [];
        try {
            const candidates = response?.candidates || [];
            for (const c of candidates) {
                const parts = c?.content?.parts || [];
                for (const p of parts) {
                    if (p.functionCall) calls.push({ name: p.functionCall.name, args: p.functionCall.args || {} });
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

    // Single short-form LLM call usable by skills for narrative steps.
    async _llmCall(prompt, { maxTokens = 800, temperature = 0.4, json = false } = {}) {
        if (!this.runtime?.hasModelClient()) return '';
        const fallbackChain = MODEL_FALLBACK_CHAIN;
        for (const modelName of fallbackChain) {
            try {
                const model = this.runtime.getModel(modelName, json);
                if (!model) continue;
                const res = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                });
                const text = res?.response?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
                if (text) return text;
            } catch (err) {
                if (this.runtime.isRetryable(err)) continue;
                break;
            }
        }
        return '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Skill execution path
    // ─────────────────────────────────────────────────────────────────────────

    async _runSkill(skillId, query, context, { traceId } = {}) {
        const orgId = context.organizationId;
        const userId = context.user?.id || 'anon';

        const plan = await aiSkillRegistryService.planSkill(skillId, context);

        const runners = {
            callTool: (toolName, args, ctx) => this._runTool(toolName, args, ctx || context, traceId),
            callLLM: (prompt, opts) => this._llmCall(prompt, opts)
        };

        const skillResult = await aiSkillRegistryService.executeSkill(skillId, plan, context, runners);

        // Synthesise the assistant message that wraps the skill output.
        const finalText = await this._narrateSkill(query, skillResult, context);

        const toolCalls = (skillResult.steps || [])
            .filter(s => (s.kind === 'tool' || s.kind === 'mutation') && s.status === 'completed' && s.tool)
            .map(s => ({ name: s.tool, args: s.args || {} }));
        const toolResults = (skillResult.steps || [])
            .filter(s => (s.kind === 'tool' || s.kind === 'mutation') && s.status === 'completed' && s.tool)
            .map(s => ({ ok: true, data: s.result, meta: null }));

        return {
            text: finalText.trim(),
            usage: null,
            action: null,
            provider: 'capita:skill',
            data: {
                type: 'skill_run',
                skill: {
                    id: skillResult.skillId,
                    label: plan.label,
                    description: plan.description,
                    rationale: plan.rationale,
                    status: skillResult.status,
                    summary: skillResult.summary,
                    steps: skillResult.steps,
                    drafts: skillResult.drafts || [],
                    narrative: skillResult.narrative || null,
                    recommendation: skillResult.recommendation || null,
                    requiresApproval: Boolean(skillResult.requiresApproval)
                },
                domain: plan.domain || null,
                grounded: true,
                confidence: 'grounded',
                toolsUsed: toolCalls.map(c => c.name),
                provenance: toolCalls.map(c => ({ tool: c.name }))
            },
            budget: await aiService.getBudgetStatus(userId, orgId)
        };
    }

    async _narrateSkill(query, skillResult, context) {
        const currency = context.currency || '';
        if (skillResult.status === 'failed') {
            return skillResult.summary || 'I couldn\'t complete that workflow.';
        }
        if (skillResult.status === 'completed_empty') {
            return skillResult.summary;
        }
        if (skillResult.skillId === 'collections_sweep' && skillResult.requiresApproval) {
            const n = (skillResult.drafts || []).length;
            return `${n} follow-ups drafted and ready below. Review each — nothing sends until you tap **Approve**.`;
        }
        if (skillResult.skillId === 'month_end_close' && skillResult.narrative) {
            return skillResult.narrative;
        }
        if (skillResult.skillId === 'cash_shortfall_response') {
            const head = skillResult.summary;
            const body = skillResult.recommendation ? `\n\n${skillResult.recommendation}` : '';
            return `${head}${body}`;
        }
        return skillResult.summary || 'Done.';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tool-use loop
    // ─────────────────────────────────────────────────────────────────────────

    async _runAgenticLoop(query, context, { traceId } = {}) {
        const orgId = context.organizationId;
        const userId = context.user?.id || 'anon';

        const budget = await aiService._checkPlanBudget(orgId);
        if (!budget.allowed) throw new Error('AI access is temporarily unavailable. Upgrade or wait for the next usage cycle.');
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
                        tools, systemInstruction, maxOutputTokens: 1200, temperature: 0.4
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

            contents.push({
                role: 'model',
                parts: calls.map(c => ({ functionCall: { name: c.name, args: c.args } }))
            });

            const settled = await Promise.all(calls.map(c => this._runTool(c.name, c.args, context, traceId)));
            calls.forEach((c, i) => { toolCalls.push(c); toolResults.push(settled[i]); });

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

        if (!finalText) {
            for (const modelName of fallbackChain) {
                try {
                    const model = this.runtime.getModelWithTools(modelName, {
                        systemInstruction, maxOutputTokens: 1200, temperature: 0.4
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
        if (workspace) workspace = await this._enrichWorkspace(workspace, orgId);

        let actionPayload = null;
        for (let i = 0; i < toolCalls.length; i++) {
            if (['create_customer', 'create_invoice_draft', 'send_reminder'].includes(toolCalls[i].name) && toolResults[i]?.ok) {
                actionPayload = { type: toolCalls[i].name, result: toolResults[i].data };
            }
        }

        const grounded = toolResults.some(r => r.ok);
        const primaryDomain = workspace?.domain || null;

        // Critic pass — flag (don't block) hallucinations.
        const verdict = await aiCriticService.verify({ query, finalText, toolCalls, toolResults });

        return {
            text: finalText.trim(),
            usage,
            action: actionPayload,
            provider: `gemini:${providerModel || 'unknown'}`,
            data: {
                type: workspace ? 'workspace_view' : (grounded ? 'grounded_answer' : 'general'),
                workspace,
                confidence: verdict.ok && grounded ? 'grounded' : (grounded ? 'grounded_warning' : 'general'),
                grounded,
                domain: primaryDomain,
                toolsUsed: toolCalls.map(c => c.name),
                provenance: toolCalls.map(c => ({ tool: c.name })),
                critic: verdict.skipped ? null : {
                    ok: verdict.ok,
                    hallucinations: verdict.hallucinations || [],
                    confidence: verdict.confidence
                }
            },
            budget: await aiService.getBudgetStatus(userId, orgId)
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────────────────────────────────

    async _classifyAndRoute(query, context) {
        const intent = await aiIntentRouterService.classify(query, context);

        // High-confidence skill match — go deliberative.
        if (intent.intent === 'skill_invocation'
            && intent.suggestedSkill
            && intent.confidence >= SKILL_CONFIDENCE_THRESHOLD) {
            return { route: 'skill', skillId: intent.suggestedSkill, intent };
        }

        return { route: 'tool_loop', intent };
    }

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

        const { route, skillId, intent } = await this._classifyAndRoute(query, { ...context, session });

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            stage: 'route',
            input: { query },
            output: { route, skillId: skillId || null, intent }
        }).catch(() => {});

        let result;
        if (route === 'skill') {
            result = await this._runSkill(skillId, query, context, { traceId });
            result.data = { ...result.data, intent };
        } else {
            result = await this._runAgenticLoop(query, context, { traceId });
            result.data = { ...result.data, intent };
        }
        result.traceId = traceId;

        aiSessionManagerService.addMessage(session, { role: 'user', content: query, intent: intent?.intent, domain: intent?.domain });
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

        const { route, skillId, intent } = await this._classifyAndRoute(query, { ...context, session });

        let result;
        if (route === 'skill') {
            result = await this._runSkill(skillId, query, context, { traceId });
            result.data = { ...result.data, intent };
        } else {
            result = await this._runAgenticLoop(query, context, { traceId });
            result.data = { ...result.data, intent };
        }

        aiSessionManagerService.addMessage(session, { role: 'user', content: query, intent: intent?.intent, domain: intent?.domain });
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
