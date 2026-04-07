import aiToolRegistryService from './aiToolRegistry.service.js';
import aiTraceService from './aiTrace.service.js';
import aiIntentService from './aiIntent.service.js';
import aiGuidedDeskService from './aiGuidedDesk.service.js';
import aiService from './ai.service.js';

// Finance data keywords — if ANY appear alongside a navigation verb, we answer with data,
// not a workspace chooser.
const FINANCE_DATA_KEYWORDS = [
    'invoice', 'invoices', 'payment', 'payments', 'expense', 'expenses',
    'compliance', 'gst', 'tds', 'overdue', 'receivable', 'receivables',
    'revenue', 'profit', 'cash', 'spend', 'budget', 'collections',
    'customer', 'customers', 'client', 'clients', 'billing', 'receipt',
    'transaction', 'transactions', 'balance', 'due', 'outstanding'
];

class AIOrchestratorService {

    async buildExecutionPlan(query, context = {}) {
        const geminiPlan = await aiService.generateExecutionPlan(query, context);
        const intent = geminiPlan.intent || 'general_advice';
        const intentMeta = aiIntentService.getMetadata(intent);
        
        return {
            intent,
            primaryDomain: intentMeta.domain || 'finance',
            specialistLabel: intentMeta.specialistLabel || intentMeta.label || 'Finance Guide',
            mode: (geminiPlan.tools && geminiPlan.tools.length > 0) ? 'grounded' : 'general',
            tools: geminiPlan.tools || []
        };
    }

    async executePlan(plan, context = {}) {
        const toolResults = [];
        const traceId = plan.traceId || null;

        for (const step of plan.tools || []) {
            const definition = aiToolRegistryService.getToolDefinition(step.toolId);
            try {
                const result = await aiToolRegistryService.executeTool(step.toolId, context, step.args || {});
                await aiTraceService.log({
                    traceId,
                    organizationId: context.organizationId,
                    userId: context.user?.id,
                    conversationId: context.conversationId || null,
                    stage: 'tool',
                    toolId: step.toolId,
                    query: context.query || null,
                    input: { args: step.args || {} },
                    output: {
                        meta: result?.meta || {},
                        data: result?.data || {}
                    }
                });
                toolResults.push({
                    toolId: step.toolId,
                    label: definition?.label || step.toolId,
                    uiComponent: definition?.uiComponent || null,
                    args: step.args || {},
                    result
                });
            } catch (error) {
                await aiTraceService.log({
                    traceId,
                    organizationId: context.organizationId,
                    userId: context.user?.id,
                    conversationId: context.conversationId || null,
                    stage: 'error',
                    toolId: step.toolId,
                    query: context.query || null,
                    input: { args: step.args || {} },
                    output: { error: error?.message || String(error) }
                });
            }
        }

        return toolResults;
    }

    /**
     * Returns true only when the user is explicitly requesting to OPEN / NAVIGATE to a workspace
     * with no specific data question attached.
     * Finance data questions must always be answered with real data, not a workspace chooser.
     */
    _shouldShowGuidedChoice(plan, query = '') {
        if (plan.intent !== 'action_request') return false;

        const lowerQuery = String(query || '').toLowerCase();
        const hasFinanceKeyword = FINANCE_DATA_KEYWORDS.some(kw => lowerQuery.includes(kw));

        // If the query asks about finance data at all, answer it — don't open a workspace chooser
        if (hasFinanceKeyword) return false;

        // Pure navigation (e.g. "open dashboard", "go to settings") → workspace chooser is fine
        return true;
    }

    // ── Non-streaming ─────────────────────────────────────────────────────────

    async processQuery(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        const plan = await this.buildExecutionPlan(query, context);
        plan.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query },
            output: plan
        });

        // ── 1. Conversational greetings / capability questions ─────────────
        if (plan.intent === 'conversational') {
            const text = aiService.buildConversationalAnswer({}, query);
            const response = {
                text,
                action: null,
                provider: 'system:conversational',
                usage: null,
                data: {
                    confidence: 'general',
                    grounded: false,
                    intent: plan.intent,
                    domain: plan.primaryDomain,
                    specialistLabel: plan.specialistLabel,
                    provenance: []
                },
                traceId
            };
            await aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'final',
                query,
                input: { executionMode: 'conversational' },
                output: { provider: response.provider, text: response.text }
            });
            return response;
        }

        // ── 2. Pure workspace-navigation action — show chooser UI ──────────
        if (this._shouldShowGuidedChoice(plan, query)) {
            const response = aiGuidedDeskService.buildGuidedChoiceResponse(query, {
                intent: plan.intent,
                primaryDomain: plan.primaryDomain,
                specialistLabel: plan.specialistLabel
            });
            response.traceId = traceId;
            await aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'final',
                query,
                input: { executionMode: 'guided_choice' },
                output: {
                    provider: response.provider,
                    text: response.text,
                    action: response.action,
                    provenance: response.data?.provenance || []
                }
            });
            return response;
        }

        // ── 3. Finance / data question — execute tools then call Gemini ────
        const toolResults = await this.executePlan(plan, context);
        const execution = {
            intent: plan.intent,
            primaryDomain: plan.primaryDomain,
            specialistLabel: plan.specialistLabel,
            mode: toolResults.length > 0 ? 'grounded' : 'general',
            toolResults,
            traceId
        };

        const response = await aiService.generateGroundedAnswer(query, context, execution);
        response.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'final',
            query,
            input: { executionMode: execution.mode, toolsRun: toolResults.length },
            output: {
                provider: response.provider,
                text: response.text,
                action: response.action,
                provenance: response.data?.provenance || []
            }
        });

        return response;
    }

    // ── Streaming version ─────────────────────────────────────────────────────

    async *processQueryStream(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        const plan = await this.buildExecutionPlan(query, context);
        plan.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query },
            output: plan
        });

        // ── 1. Conversational — yield a direct text answer immediately ─────
        if (plan.intent === 'conversational') {
            const text = aiService.buildConversationalAnswer({}, query);
            const event = {
                type: 'complete',
                text,
                action: null,
                usage: null,
                provider: 'system:conversational',
                budget: null,
                data: {
                    confidence: 'general',
                    grounded: false,
                    intent: plan.intent,
                    domain: plan.primaryDomain,
                    specialistLabel: plan.specialistLabel,
                    provenance: []
                },
                traceId
            };
            await aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'final',
                query,
                input: { executionMode: 'conversational' },
                output: { provider: event.provider, text: event.text }
            });
            yield event;
            return;
        }

        // ── 2. Pure workspace navigation — yield chooser UI ────────────────
        if (this._shouldShowGuidedChoice(plan, query)) {
            const event = {
                type: 'complete',
                ...aiGuidedDeskService.buildGuidedChoiceResponse(query, {
                    intent: plan.intent,
                    primaryDomain: plan.primaryDomain,
                    specialistLabel: plan.specialistLabel
                }),
                traceId
            };
            await aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'final',
                query,
                input: { executionMode: 'guided_choice' },
                output: {
                    provider: event.provider,
                    text: event.text,
                    action: event.action,
                    provenance: event.data?.provenance || []
                }
            });
            yield event;
            return;
        }

        // ── 3. Finance / data question — execute tools then stream Gemini ──
        // Tool execution is fast (DB reads) and happens before streaming starts.
        const toolResults = await this.executePlan(plan, context);
        const execution = {
            intent: plan.intent,
            primaryDomain: plan.primaryDomain,
            specialistLabel: plan.specialistLabel,
            mode: toolResults.length > 0 ? 'grounded' : 'general',
            toolResults,
            traceId
        };

        const stream = aiService.generateGroundedAnswerStream(query, context, execution);
        let lastEvent = null;

        for await (const chunk of stream) {
            lastEvent = chunk;
            if (chunk.type === 'token') {
                yield chunk;
            } else if (chunk.type === 'complete') {
                yield { ...chunk, traceId };
            }
        }

        if (lastEvent) {
            await aiTraceService.log({
                traceId,
                organizationId: context.organizationId,
                userId: context.user?.id,
                conversationId: context.conversationId || null,
                stage: 'final',
                query,
                input: { executionMode: execution.mode, toolsRun: toolResults.length },
                output: {
                    provider: lastEvent.provider,
                    text: lastEvent.text,
                    action: lastEvent.action,
                    provenance: lastEvent.data?.provenance || []
                }
            });
        }
    }
}

export default new AIOrchestratorService();
