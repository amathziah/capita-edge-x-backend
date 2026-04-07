import aiToolRegistryService from './aiToolRegistry.service.js';
import aiTraceService from './aiTrace.service.js';
import aiIntentService from './aiIntent.service.js';
import aiGuidedDeskService from './aiGuidedDesk.service.js';

class AIOrchestratorService {
    async buildExecutionPlan(query, context = {}) {
        const intent = aiIntentService.detect(query);
        const intentMeta = aiIntentService.getMetadata(intent);
        const tools = await aiToolRegistryService.planTools(query, context);
        return {
            intent,
            primaryDomain: intentMeta.domain || 'finance',
            specialistLabel: intentMeta.specialistLabel || intentMeta.label || 'Finance Guide',
            mode: tools.length > 0 ? 'grounded' : 'general',
            tools
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
                    output: {
                        error: error?.message || String(error)
                    }
                });
            }
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
    }
}

export default new AIOrchestratorService();
