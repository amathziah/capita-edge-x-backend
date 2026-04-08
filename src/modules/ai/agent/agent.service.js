/**
 * AI Agent Service
 * 
 * Multi-step reasoning and complex query handling:
 * - Plan execution with reasoning steps
 * - Tool chaining for complex workflows
 * - Context preservation across steps
 * - Result aggregation from multiple tools
 * - Iterative refinement
 */

import aiToolRegistryService from '../workspace/toolRegistry.service.js';
import aiReadModelService from '../workspace/readModel.service.js';
import aiTraceService from '../infra/trace.service.js';
import aiEnhancedIntentService from '../intent/enhanced.service.js';
import aiSemanticSearchService from '../search/semantic.service.js';

const TOOL_TIMEOUT_MS = 10_000; // 10 s per tool call

class AIAgentService {
    constructor() {
        this.maxSteps = 5;
        this.maxToolCalls = 10;
        this.reasoningDepth = 3;
    }

    _withTimeout(promise, ms, toolId) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Tool ${toolId} timed out after ${ms}ms`)), ms)
            )
        ]);
    }

    /**
     * Main agent executor - handles complex queries with multi-step reasoning
     */
    async execute(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        
        // Step 1: Parse and understand the query
        const parsedQuery = this.parseQuery(query, context);
        
        // Step 2: Generate execution plan
        const plan = await this.generatePlan(parsedQuery, context);
        
        // Step 3: Execute plan with reasoning
        const executionResult = await this.executePlanWithReasoning(plan, context, traceId);
        
        // Step 4: Aggregate results
        const aggregated = this.aggregateResults(executionResult);
        
        // Step 5: Generate final response
        const response = await this.generateResponse(query, aggregated, context);

        return {
            ...response,
            traceId,
            reasoning: executionResult.reasoning,
            steps: executionResult.steps,
            toolsExecuted: executionResult.toolResults.length
        };
    }

    /**
     * Parse query to understand structure and intent
     */
    parseQuery(query, context = {}) {
        const intentResult = aiEnhancedIntentService.detectWithConfidence(query, context);
        
        return {
            originalQuery: query,
            intents: [intentResult.primaryIntent, ...intentResult.secondaryIntents],
            confidence: intentResult.confidence,
            complexity: intentResult.complexity,
            requiresComparison: intentResult.requiresComparison,
            requiresReasoning: intentResult.requiresReasoning,
            parsedEntities: intentResult.parsedEntities,
            timeRange: intentResult.timeRange,
            suggestedActions: intentResult.suggestedActions,
            isMultiStep: this.detectMultiStep(query),
            isComparative: intentResult.requiresComparison,
            isFollowUp: context?.lastQuery && this.isFollowUp(query, context.lastQuery)
        };
    }

    /**
     * Detect if query requires multi-step reasoning
     */
    detectMultiStep(query) {
        const multiStepIndicators = [
            /and then/i,
            /after that/i,
            /first.*then/i,
            /also/i,
            /plus/i,
            /in addition/i,
            /besides/i,
            /furthermore/i,
            /moreover/i,
            /what about/i,
            /and what/i,
            /but also/i,
            /as well as/i
        ];

        const queryLength = query.split(/\s+/).length;
        
        return multiStepIndicators.some(pattern => pattern.test(query)) || queryLength > 30;
    }

    /**
     * Check if query is a follow-up
     */
    isFollowUp(currentQuery, lastQuery) {
        const followUpIndicators = [
            /^what about/i,
            /^(and|but|so)/i,
            /^then/i,
            /^ok$/i,
            /^sure$/i,
            /^yes$/i,
            /^continue/i,
            /^go on/i,
            /^more/i
        ];

        const shortQuery = currentQuery.split(/\s+/).length <= 5;
        
        if (followUpIndicators.some(pattern => pattern.test(currentQuery))) {
            return true;
        }

        // Check for implicit follow-up
        if (shortQuery && lastQuery) {
            return true;
        }

        return false;
    }

    /**
     * Generate execution plan with steps
     */
    async generatePlan(parsedQuery, context = {}) {
        const steps = [];
        
        if (parsedQuery.isComparative) {
            // For comparison queries, plan to fetch multiple data sources
            steps.push({
                step: 1,
                action: 'fetch_comparison_data',
                description: 'Fetch data for comparison',
                tools: this.getComparisonTools(parsedQuery)
            });
        } else if (parsedQuery.complexity === 'complex' || parsedQuery.isMultiStep) {
            // Complex query - break into steps
            const mainIntent = parsedQuery.intents[0];
            
            steps.push({
                step: 1,
                action: 'fetch_primary_data',
                description: `Fetch primary data for ${mainIntent}`,
                tools: this.getPrimaryTools(mainIntent)
            });

            // Add secondary data if needed
            if (parsedQuery.intents.length > 1) {
                const secondaryIntent = parsedQuery.intents[1];
                steps.push({
                    step: 2,
                    action: 'fetch_secondary_data',
                    description: `Fetch secondary data for ${secondaryIntent}`,
                    tools: this.getPrimaryTools(secondaryIntent)
                });
            }

            // Add context data if needed
            if (parsedQuery.requiresReasoning) {
                steps.push({
                    step: 3,
                    action: 'fetch_context',
                    description: 'Fetch additional context',
                    tools: ['get_dashboard_snapshot', 'get_recent_activity']
                });
            }
        } else {
            // Simple query - single step
            const mainIntent = parsedQuery.intents[0];
            steps.push({
                step: 1,
                action: 'fetch_data',
                description: `Fetch data for ${mainIntent}`,
                tools: this.getPrimaryTools(mainIntent)
            });
        }

        // Add knowledge base lookup if needed
        if (this.needsKnowledgeBase(parsedQuery)) {
            steps.push({
                step: steps.length + 1,
                action: 'fetch_knowledge',
                description: 'Search knowledge base',
                tools: ['get_knowledge_base']
            });
        }

        return {
            steps,
            maxSteps: this.maxSteps,
            estimatedComplexity: parsedQuery.complexity,
            isMultiStep: parsedQuery.isMultiStep
        };
    }

    /**
     * Get tools for comparison queries
     */
    getComparisonTools(parsedQuery) {
        const tools = [];
        
        if (parsedQuery.intents.includes('invoices_attention')) {
            tools.push('get_invoice_workspace', 'get_overdue_invoices');
        }
        if (parsedQuery.intents.includes('payments_recent')) {
            tools.push('get_payment_workspace');
        }
        if (parsedQuery.intents.includes('expenses_spend')) {
            tools.push('get_expense_workspace');
        }

        return tools.length > 0 ? tools : ['get_dashboard_snapshot'];
    }

    /**
     * Get primary tools for an intent
     */
    getPrimaryTools(intent) {
        const toolMapping = {
            business_health: ['get_business_advisor_context'],
            cash_flow: ['get_dashboard_snapshot', 'get_payment_workspace'],
            payments_recent: ['get_payment_workspace'],
            invoices_attention: ['get_invoice_workspace', 'get_overdue_invoices'],
            expenses_spend: ['get_expense_workspace'],
            compliance_status: ['get_compliance_workspace'],
            compliance_knowledge: ['get_compliance_workspace', 'get_knowledge_base'],
            customer_insights: ['get_customer_insights'],
            general_advice: ['get_dashboard_snapshot', 'get_recent_activity']
        };

        return toolMapping[intent] || ['get_dashboard_snapshot'];
    }

    /**
     * Check if knowledge base lookup is needed
     */
    needsKnowledgeBase(parsedQuery) {
        const knowledgeIntents = ['compliance_knowledge', 'general_advice'];
        const hasKnowledge = parsedQuery.intents.some(i => knowledgeIntents.includes(i));
        
        const questionWords = ['what is', 'how does', 'explain', 'rules', 'policy', 'guidelines'];
        const hasQuestion = questionWords.some(w => parsedQuery.originalQuery.toLowerCase().includes(w));
        
        return hasKnowledge || (hasQuestion && parsedQuery.complexity !== 'complex');
    }

    /**
     * Execute plan with reasoning steps
     */
    async executePlanWithReasoning(plan, context, traceId) {
        const results = [];
        const reasoning = [];
        let toolCallCount = 0;

        for (const step of plan.steps) {
            if (toolCallCount >= this.maxToolCalls) {
                reasoning.push({
                    step: step.step,
                    thought: `Stopping at step ${step.step} - max tool calls reached`,
                    action: 'stop'
                });
                break;
            }

            reasoning.push({
                step: step.step,
                thought: `Executing: ${step.description}`,
                action: step.action
            });

            // Execute tools for this step
            for (const toolId of step.tools) {
                if (toolCallCount >= this.maxToolCalls) break;

                try {
                    const toolResult = await this._withTimeout(
                        aiToolRegistryService.executeTool(toolId, context, {}),
                        TOOL_TIMEOUT_MS,
                        toolId
                    );
                    
                    results.push({
                        step: step.step,
                        toolId,
                        result: toolResult,
                        success: true
                    });

                    toolCallCount++;

                    reasoning.push({
                        step: step.step,
                        tool: toolId,
                        thought: `Retrieved: ${Object.keys(toolResult?.data || {}).join(', ')}`,
                        action: 'tool_executed'
                    });
                } catch (error) {
                    results.push({
                        step: step.step,
                        toolId,
                        error: error.message,
                        success: false
                    });

                    reasoning.push({
                        step: step.step,
                        tool: toolId,
                        thought: `Error: ${error.message}`,
                        action: 'tool_error'
                    });
                }
            }
        }

        return {
            steps: plan.steps,
            toolResults: results,
            reasoning,
            success: results.filter(r => r.success).length > 0
        };
    }

    /**
     * Aggregate results from multiple tools
     */
    aggregateResults(executionResult) {
        const aggregated = {
            data: {},
            metadata: {
                sources: new Set(),
                domains: new Set(),
                hasData: false
            }
        };

        for (const result of executionResult.toolResults) {
            if (!result.success || !result.result) continue;

            const data = result.result.data || {};
            const meta = result.result.meta || {};

            // Merge data
            Object.assign(aggregated.data, data);

            // Track sources
            if (meta.source) {
                aggregated.metadata.sources.add(meta.source);
            }
            if (meta.domain) {
                aggregated.metadata.domains.add(meta.domain);
            }
        }

        aggregated.metadata.hasData = Object.keys(aggregated.data).length > 0;
        aggregated.metadata.sources = Array.from(aggregated.metadata.sources);
        aggregated.metadata.domains = Array.from(aggregated.metadata.domains);

        return aggregated;
    }

    /**
     * Generate final response from aggregated results
     */
    async generateResponse(query, aggregated, context) {
        const hasData = aggregated.metadata.hasData;
        
        if (!hasData) {
            return {
                text: 'I need more information to answer that. Could you please provide more details?',
                data: {
                    needsMoreInfo: true,
                    domains: [],
                    provenance: []
                }
            };
        }

        // For now, return aggregated data - the actual response generation
        // will be handled by the grounding service
        return {
            aggregatedData: aggregated.data,
            metadata: aggregated.metadata,
            needsGrounding: true
        };
    }

    /**
     * Handle iterative refinement
     */
    async refine(query, previousResult, context = {}) {
        const refinementQuery = `${previousResult.originalQuery} - specifically: ${query}`;
        
        // Use previous context
        const refinedContext = {
            ...context,
            lastQuery: previousResult.originalQuery,
            previousData: previousResult.aggregatedData,
            reasoning: previousResult.reasoning
        };

        return this.execute(refinementQuery, refinedContext);
    }

    /**
     * Stream agent execution
     */
    async *executeStream(query, context = {}) {
        const traceId = aiTraceService.createTraceId();
        
        // Parse query
        const parsedQuery = this.parseQuery(query, context);
        
        // Yield plan
        yield { type: 'plan', parsedQuery };
        
        // Generate and execute plan
        const plan = await this.generatePlan(parsedQuery, context);
        yield { type: 'plan_ready', plan };
        
        // Execute with steps
        const executionResult = await this.executePlanWithReasoning(plan, context, traceId);
        
        // Yield each step result
        for (const stepResult of executionResult.toolResults) {
            if (stepResult.success) {
                yield { type: 'step_complete', step: stepResult.step, tool: stepResult.toolId };
            }
        }

        // Aggregate and yield final result
        const aggregated = this.aggregateResults(executionResult);
        yield { type: 'ready_for_response', aggregated, reasoning: executionResult.reasoning };
    }
}

export default new AIAgentService();