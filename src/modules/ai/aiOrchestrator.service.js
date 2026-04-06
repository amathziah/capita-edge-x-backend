import aiService from './ai.service.js';
import aiToolRegistryService from './aiToolRegistry.service.js';
import aiTraceService from './aiTrace.service.js';
import aiActionRegistryService from './aiActionRegistry.service.js';

class AIOrchestratorService {
    async buildExecutionPlan(query, context = {}) {
        const tools = await aiToolRegistryService.planTools(query, context);
        return {
            mode: tools.length > 0 ? 'grounded' : 'general',
            tools
        };
    }

    async executePlan(plan, context = {}) {
        const toolResults = [];
        const traceId = plan.traceId || null;

        for (const step of plan.tools || []) {
            const definition = aiToolRegistryService.getToolDefinition(step.toolId);
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
        }

        return toolResults;
    }

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
        const toolResults = await this.executePlan(plan, context);
        const execution = {
            mode: plan.mode,
            toolResults,
            traceId
        };
        const response = await aiService.generateGroundedAnswer(query, context, execution);
        response.action = aiActionRegistryService.suggestAction(query, context, execution) || response.action;
        response.traceId = traceId;

        await aiTraceService.log({
            traceId,
            organizationId: context.organizationId,
            userId: context.user?.id,
            conversationId: context.conversationId || null,
            stage: 'final',
            query,
            input: { executionMode: execution.mode },
            output: {
                provider: response.provider,
                text: response.text,
                action: response.action,
                provenance: response.data?.provenance || []
            }
        });

        return response;
    }

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
        const toolResults = await this.executePlan(plan, context);
        const execution = {
            mode: plan.mode,
            toolResults,
            traceId
        };

        for (const toolResult of toolResults) {
            if (toolResult.uiComponent) {
                yield {
                    type: 'gen_ui',
                    component: toolResult.uiComponent,
                    data: toolResult.result?.data
                };
            }
        }

        for await (const event of aiService.generateGroundedAnswerStream(query, context, execution)) {
            if (event.type === 'complete') {
                event.action = aiActionRegistryService.suggestAction(query, context, execution) || event.action;
                event.traceId = traceId;

                await aiTraceService.log({
                    traceId,
                    organizationId: context.organizationId,
                    userId: context.user?.id,
                    conversationId: context.conversationId || null,
                    stage: 'final',
                    query,
                    input: { executionMode: execution.mode },
                    output: {
                        provider: event.provider,
                        text: event.text,
                        action: event.action,
                        provenance: event.data?.provenance || []
                    }
                });
            }
            yield event;
        }
    }
}

export default new AIOrchestratorService();
