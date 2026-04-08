import aiToolRegistryService from '../workspace/toolRegistry.service.js';
import aiTraceService from '../infra/trace.service.js';
import aiIntentService from '../intent/basic.service.js';
import aiEnhancedIntentService from '../intent/enhanced.service.js';
import aiGuidedDeskService from '../workspace/guidedDesk.service.js';
import aiService from './ai.service.js';
import aiAgentService from '../agent/agent.service.js';
import aiCachingService from '../infra/cache.service.js';
import aiSessionManagerService from '../agent/session.service.js';

const FINANCE_DATA_KEYWORDS = [
    'invoice', 'invoices', 'payment', 'payments', 'expense', 'expenses',
    'compliance', 'gst', 'tds', 'overdue', 'receivable', 'receivables',
    'revenue', 'profit', 'cash', 'spend', 'budget', 'collections',
    'customer', 'customers', 'client', 'clients', 'billing', 'receipt',
    'transaction', 'transactions', 'balance', 'due', 'outstanding'
];

// Domain detection keywords for workspace auto-opening
const DOMAIN_KEYWORDS = {
    invoices: ['invoice', 'invoices', 'overdue', 'receivable', 'receivables', 'collections', 'debtor', 'aging', 'unpaid', 'outstanding'],
    payments: ['payment', 'payments', 'receipt', 'receipts', 'cash in', 'money in', 'received', 'collections'],
    expenses: ['expense', 'expenses', 'spend', 'spending', 'cost', 'costs', 'vendor', 'burn', 'outflow'],
    compliance: ['compliance', 'gst', 'tds', 'tax', 'filing', 'deadline', 'return', 'due'],
    customers: ['customer', 'customers', 'client', 'clients', 'churn', 'retention']
};

class AIOrchestratorService {

    async buildExecutionPlan(query, context = {}) {
        // Try cache first for simple queries
        const cacheKey = aiCachingService.getCacheKey('plan', context.organizationId, query);
        const cachedPlan = aiCachingService.getFromMemory(cacheKey);
        if (cachedPlan && !context.skipCache) {
            console.log('[Orchestrator] Using cached execution plan');
            return cachedPlan;
        }

        // Use enhanced intent detection with confidence scoring
        const intentResult = aiEnhancedIntentService.detectWithConfidence(query, {
            ...context,
            lastIntent: context.lastIntent,
            lastQuery: context.lastQuery
        });

        // Determine if we need agent-style multi-step reasoning
        const needsAgent = intentResult.complexity === 'complex' || 
                          intentResult.requiresComparison ||
                          intentResult.requiresReasoning ||
                          intentResult.isMultiStep;

        let tools = [];
        let intent = intentResult.primaryIntent;

        if (needsAgent) {
            // Use agent service for complex queries
            console.log('[Orchestrator] Using agent service for complex query');
            const agentPlan = await aiAgentService.generatePlan(
                { intents: [intent, ...intentResult.secondaryIntents], complexity: intentResult.complexity },
                context
            );
            
            // Convert agent plan steps to tools
            for (const step of agentPlan.steps) {
                for (const toolId of step.tools) {
                    if (!tools.find(t => t.toolId === toolId)) {
                        tools.push({ toolId, args: {} });
                    }
                }
            }
        } else {
            // Use standard tool selection
            tools = aiEnhancedIntentService.getToolsForIntents([intent, ...intentResult.secondaryIntents]);
        }

        // Fallback: If no tools detected but data-driven intent found
        if (tools.length === 0) {
            const fallbackIntent = aiIntentService.detect(query);
            if (fallbackIntent !== 'conversational' && fallbackIntent !== 'general_advice') {
                const fallbackTools = aiIntentService.getToolsForIntent(fallbackIntent);
                if (fallbackTools.length > 0) {
                    intent = fallbackIntent;
                    tools = fallbackTools.map(toolId => ({ toolId, args: {} }));
                }
            }
        }

        const plan = {
            intent,
            primaryDomain: intentResult.domain,
            specialistLabel: intentResult.specialistLabel,
            mode: tools.length > 0 ? 'grounded' : 'general',
            tools,
            confidence: intentResult.confidence,
            complexity: intentResult.complexity,
            isMultiStep: intentResult.isMultiStep || needsAgent,
            requiresComparison: intentResult.requiresComparison,
            requiresReasoning: intentResult.requiresReasoning,
            suggestedActions: intentResult.suggestedActions,
            timeRange: intentResult.timeRange,
            parsedEntities: intentResult.parsedEntities
        };

        // Cache the plan
        aiCachingService.setMemoryCache(cacheKey, plan, 'intent');

        return plan;
    }

    async executePlan(plan, context = {}) {
        const toolResults = [];
        const failedTools = [];
        const traceId = plan.traceId || null;

        for (const step of plan.tools || []) {
            const definition = aiToolRegistryService.getToolDefinition(step.toolId);

            // Check cache for tool results
            const cacheKey = aiCachingService.getCacheKey(
                'tool',
                context.organizationId,
                `${step.toolId}:${JSON.stringify(step.args)}`
            );
            const cachedResult = aiCachingService.getFromMemory(cacheKey);

            if (cachedResult) {
                toolResults.push({
                    toolId: step.toolId,
                    label: definition?.label || step.toolId,
                    uiComponent: definition?.uiComponent || null,
                    args: step.args || {},
                    result: cachedResult
                });
                continue;
            }

            try {
                const result = await aiToolRegistryService.executeTool(step.toolId, context, step.args || {});

                aiCachingService.setMemoryCache(cacheKey, result, 'workspace');

                await aiTraceService.log({
                    traceId,
                    organizationId: context.organizationId,
                    userId: context.user?.id,
                    conversationId: context.conversationId || null,
                    stage: 'tool',
                    toolId: step.toolId,
                    query: context.query || null,
                    input: { args: step.args || {} },
                    output: { meta: result?.meta || {}, data: result?.data || {} }
                });

                toolResults.push({
                    toolId: step.toolId,
                    label: definition?.label || step.toolId,
                    uiComponent: definition?.uiComponent || null,
                    args: step.args || {},
                    result
                });
            } catch (error) {
                console.error(`[Orchestrator] Tool ${step.toolId} failed:`, error.message);
                failedTools.push({ toolId: step.toolId, error: error?.message || String(error) });
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

        return { toolResults, failedTools };
    }

    /**
     * Check if query should trigger guided workspace auto-opening
     */
    _shouldOpenGuidedWorkspace(query = '') {
        const lowerQuery = String(query || '').toLowerCase();
        
        for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
            const hasKeyword = keywords.some(kw => lowerQuery.includes(kw));
            if (hasKeyword) {
                return domain;
            }
        }
        
        return null;
    }

    /**
     * Check if we should show guided choice (legacy behavior for action_request without finance keywords)
     */
    _shouldShowGuidedChoice(plan, query = '') {
        const manualIntent = aiIntentService.detect(query);
        const intent = manualIntent === 'action_request' ? 'action_request' : (plan.intent || manualIntent);

        if (intent !== 'action_request') return false;

        const lowerQuery = String(query || '').toLowerCase();
        const hasFinanceKeyword = FINANCE_DATA_KEYWORDS.some(kw => lowerQuery.includes(kw));

        if (hasFinanceKeyword) return false;

        return true;
    }

    /**
     * Build workspace response for frontend - includes guided workspace data
     */
    _buildWorkspaceResponse(toolResults, plan, query, organizationId) {
        // Find the primary tool with uiComponent (workspace tool)
        const workspaceTool = toolResults.find(t => t.uiComponent);
        
        if (!workspaceTool) return null;

        const domain = workspaceTool.uiComponent.replace('ai_domain_', '');
        
        // Build the guided workspace response
        const workspace = aiGuidedDeskService.getWorkspace(domain, organizationId, 'overview');
        
        // This returns a Promise - we'll handle it in the caller
        return {
            component: workspaceTool.uiComponent,
            domain,
            data: workspaceTool.result?.data || {},
            toolId: workspaceTool.toolId
        };
    }

    // ── Non-streaming ─────────────────────────────────────────────────────────

    async processQuery(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        
        // Get or create session for context management
        const session = await aiSessionManagerService.getOrCreateSession(
            context.organizationId,
            context.user?.id,
            context.conversationId
        );

        // Build context with session info
        const enhancedContext = {
            ...context,
            sessionId: session.id,
            sessionContext: aiSessionManagerService.buildAIContext(session, query),
            lastIntent: session.metadata.currentDomain,
            lastQuery: session.messages.length > 0 ? session.messages[session.messages.length - 1].content : null
        };

        // Check cache for complete response
        const cachedResponse = await aiCachingService.get('chat', context.organizationId, query);
        if (cachedResponse && !context.skipCache) {
            console.log('[Orchestrator] Using cached response');
            cachedResponse.data.traceId = traceId;
            return cachedResponse.data;
        }

        const plan = await this.buildExecutionPlan(query, enhancedContext);
        plan.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query, complexity: plan.complexity },
            output: plan
        });

        // Guided choice — only for pure navigation (action_request intent with no data question words)
        const isGuidedChoice = this._shouldShowGuidedChoice(plan, query);
        if (isGuidedChoice) {
            const response = aiGuidedDeskService.buildGuidedChoiceResponse(query, {
                intent: plan.intent,
                primaryDomain: plan.primaryDomain,
                specialistLabel: plan.specialistLabel
            });
            response.traceId = traceId;
            
            // Update session
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: response.text, intent: plan.intent, domain: plan.primaryDomain });
            
            return response;
        }

        // Conversational
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
            
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: text, intent: plan.intent, domain: plan.primaryDomain });
            
            return response;
        }

        // Complex query - use agent service
        if (plan.isMultiStep || plan.requiresComparison) {
            console.log('[Orchestrator] Handling complex query with agent service');
            
            const agentResult = await aiAgentService.execute(query, enhancedContext);
            
            // Use agent's aggregated results
            const execution = {
                intent: plan.intent,
                primaryDomain: plan.primaryDomain,
                specialistLabel: plan.specialistLabel,
                mode: 'grounded',
                toolResults: agentResult.steps.map(s => ({
                    toolId: s.toolId,
                    result: s.result
                })),
                traceId
            };

            const response = await aiService.generateGroundedAnswer(query, enhancedContext, execution);
            response.traceId = traceId;
            response.data.reasoning = agentResult.reasoning;
            response.data.steps = agentResult.steps;

            // Update session with entities
            if (plan.parsedEntities) {
                aiSessionManagerService.extractEntities(session, plan.parsedEntities);
            }
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: response.text, intent: plan.intent, domain: plan.primaryDomain });

            // Cache response
            await aiCachingService.set('chat', context.organizationId, query, response, { persist: true });

            return response;
        }

        // Standard query execution
        const { toolResults, failedTools } = await this.executePlan(plan, enhancedContext);

        // Check if any tool has a workspace uiComponent - if so, include workspace data
        const hasWorkspaceTool = toolResults.some(t => t.uiComponent);

        const execution = {
            intent: plan.intent,
            primaryDomain: plan.primaryDomain,
            specialistLabel: plan.specialistLabel,
            mode: toolResults.length > 0 ? 'grounded' : 'general',
            toolResults,
            traceId
        };

        const response = await aiService.generateGroundedAnswer(query, enhancedContext, execution);
        response.traceId = traceId;

        // Attach tool-failure warnings so the frontend can surface them
        if (failedTools.length > 0) {
            response.data = response.data || {};
            response.data.warnings = failedTools.map(f =>
                `Some data could not be retrieved (${f.toolId.replace(/_/g, ' ')}). The response above is based on available data only.`
            );
            response.data.partialData = true;
        }

        // If we have a workspace tool, also provide the workspace data for frontend
        if (hasWorkspaceTool) {
            const workspaceTool = toolResults.find(t => t.uiComponent);
            const workspaceDomain = workspaceTool.uiComponent.replace('ai_domain_', '');

            try {
                const workspace = await aiGuidedDeskService.getWorkspace(workspaceDomain, context.organizationId, 'overview');
                response.data = response.data || {};
                response.data.workspace = {
                    component: workspaceTool.uiComponent,
                    domain: workspaceDomain,
                    label: workspace?.label,
                    specialistLabel: workspace?.specialistLabel,
                    selectedView: 'overview',
                    availableViews: workspace?.availableViews,
                    data: workspace?.data,
                    meta: workspace?.meta
                };
            } catch (wsError) {
                console.error('[Orchestrator] Failed to get workspace data:', wsError.message);
            }
        }

        // Update session
        if (plan.parsedEntities) {
            aiSessionManagerService.extractEntities(session, plan.parsedEntities);
        }
        aiSessionManagerService.addMessage(session, { role: 'assistant', content: response.text, intent: plan.intent, domain: plan.primaryDomain });

        // Cache response
        await aiCachingService.set('chat', context.organizationId, query, response, { persist: true });

        return response;
    }

    // ── Streaming version ─────────────────────────────────────────────────────

    async *processQueryStream(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        
        // Get session
        const session = await aiSessionManagerService.getOrCreateSession(
            context.organizationId,
            context.user?.id,
            context.conversationId
        );

        const enhancedContext = {
            ...context,
            sessionId: session.id,
            sessionContext: aiSessionManagerService.buildAIContext(session, query),
            lastIntent: session.metadata.currentDomain,
            lastQuery: session.messages.length > 0 ? session.messages[session.messages.length - 1].content : null
        };

        const plan = await this.buildExecutionPlan(query, enhancedContext);
        plan.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'plan',
            query,
            input: { query, complexity: plan.complexity },
            output: plan
        });

        // Guided choice — only for pure navigation (action_request intent with no data question words)
        const isGuidedChoice = this._shouldShowGuidedChoice(plan, query);
        if (isGuidedChoice) {
            const event = {
                type: 'complete',
                ...aiGuidedDeskService.buildGuidedChoiceResponse(query, {
                    intent: plan.intent,
                    primaryDomain: plan.primaryDomain,
                    specialistLabel: plan.specialistLabel
                }),
                traceId
            };
            yield event;
            return;
        }

        // Conversational
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
            yield event;
            return;
        }

        // Complex query with agent
        if (plan.isMultiStep || plan.requiresComparison) {
            const stream = aiAgentService.executeStream(query, enhancedContext);
            
            for await (const chunk of stream) {
                if (chunk.type === 'step_complete') {
                    yield { type: 'progress', tool: chunk.tool, step: chunk.step };
                }
            }

            const agentResult = await aiAgentService.execute(query, enhancedContext);
            
            const execution = {
                intent: plan.intent,
                primaryDomain: plan.primaryDomain,
                specialistLabel: plan.specialistLabel,
                mode: 'grounded',
                toolResults: agentResult.steps.map(s => ({
                    toolId: s.toolId,
                    result: s.result
                })),
                traceId
            };

            const stream2 = aiService.generateGroundedAnswerStream(query, enhancedContext, execution);
            
            for await (const chunk of stream2) {
                if (chunk.type === 'token') {
                    yield chunk;
                } else if (chunk.type === 'complete') {
                    yield { 
                        ...chunk, 
                        traceId,
                        data: {
                            ...chunk.data,
                            reasoning: agentResult.reasoning,
                            steps: agentResult.steps
                        }
                    };
                }
            }
            
            if (plan.parsedEntities) {
                aiSessionManagerService.extractEntities(session, plan.parsedEntities);
            }
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: '', intent: plan.intent, domain: plan.primaryDomain });
            
            return;
        }

        // Standard execution
        const { toolResults, failedTools } = await this.executePlan(plan, enhancedContext);

        // Check if any tool has a workspace uiComponent
        const hasWorkspaceTool = toolResults.some(t => t.uiComponent);

        const execution = {
            intent: plan.intent,
            primaryDomain: plan.primaryDomain,
            specialistLabel: plan.specialistLabel,
            mode: toolResults.length > 0 ? 'grounded' : 'general',
            toolResults,
            traceId
        };

        const stream = aiService.generateGroundedAnswerStream(query, enhancedContext, execution);
        let lastEvent = null;

        for await (const chunk of stream) {
            lastEvent = chunk;
            if (chunk.type === 'token') {
                yield chunk;
            } else if (chunk.type === 'complete') {
                // Build enriched data with tool-failure warnings and workspace
                const enrichedData = { ...chunk.data };

                if (failedTools.length > 0) {
                    enrichedData.warnings = failedTools.map(f =>
                        `Some data could not be retrieved (${f.toolId.replace(/_/g, ' ')}). Response is based on available data only.`
                    );
                    enrichedData.partialData = true;
                }

                if (hasWorkspaceTool) {
                    const workspaceTool = toolResults.find(t => t.uiComponent);
                    const workspaceDomain = workspaceTool.uiComponent.replace('ai_domain_', '');
                    try {
                        const workspace = await aiGuidedDeskService.getWorkspace(workspaceDomain, context.organizationId, 'overview');
                        enrichedData.workspace = {
                            component: workspaceTool.uiComponent,
                            domain: workspaceDomain,
                            label: workspace?.label,
                            specialistLabel: workspace?.specialistLabel,
                            selectedView: 'overview',
                            availableViews: workspace?.availableViews,
                            data: workspace?.data,
                            meta: workspace?.meta
                        };
                    } catch (wsError) {
                        console.error('[Orchestrator] Failed to get workspace data:', wsError.message);
                    }
                }

                yield { ...chunk, traceId, data: enrichedData };
            }
        }

        if (lastEvent && plan.parsedEntities) {
            aiSessionManagerService.extractEntities(session, plan.parsedEntities);
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: lastEvent.text, intent: plan.intent, domain: plan.primaryDomain });
        }
    }
}

export default new AIOrchestratorService();
