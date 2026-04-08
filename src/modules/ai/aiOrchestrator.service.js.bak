import aiToolRegistryService from './aiToolRegistry.service.js';
import aiTraceService from './aiTrace.service.js';
import aiIntentService from './aiIntent.service.js';
import aiEnhancedIntentService from './aiEnhancedIntent.service.js';
import aiGuidedDeskService from './aiGuidedDesk.service.js';
import aiService from './ai.service.js';
import aiAgentService from './aiAgent.service.js';
import aiCachingService from './aiCaching.service.js';
import aiSessionManagerService from './aiSessionManager.service.js';

const FINANCE_DATA_KEYWORDS = [
    'invoice', 'invoices', 'payment', 'payments', 'expense', 'expenses',
    'compliance', 'gst', 'tds', 'overdue', 'receivable', 'receivables',
    'revenue', 'profit', 'cash', 'spend', 'budget', 'collections',
    'customer', 'customers', 'client', 'clients', 'billing', 'receipt',
    'transaction', 'transactions', 'balance', 'due', 'outstanding'
];

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
                console.log(`[Orchestrator] Using cached result for ${step.toolId}`);
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
                
                // Cache the result
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

    _shouldShowGuidedChoice(plan, query = '') {
        const manualIntent = aiIntentService.detect(query);
        const intent = manualIntent === 'action_request' ? 'action_request' : (plan.intent || manualIntent);

        if (intent !== 'action_request') return false;

        const lowerQuery = String(query || '').toLowerCase();
        const hasFinanceKeyword = FINANCE_DATA_KEYWORDS.some(kw => lowerQuery.includes(kw));

        if (hasFinanceKeyword) return false;

        return true;
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

        // Guided choice
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
        const toolResults = await this.executePlan(plan, enhancedContext);
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

        // Guided choice
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
        const toolResults = await this.executePlan(plan, enhancedContext);
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
                yield { ...chunk, traceId };
            }
        }

        if (lastEvent && plan.parsedEntities) {
            aiSessionManagerService.extractEntities(session, plan.parsedEntities);
            aiSessionManagerService.addMessage(session, { role: 'assistant', content: lastEvent.text, intent: plan.intent, domain: plan.primaryDomain });
        }
    }
}

export default new AIOrchestratorService();