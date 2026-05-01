import { supabase } from '../../../core/database/supabase.js';
import aiService from '../core/ai.service.js';
import aiOrchestratorService from '../core/orchestrator.service.js';
import aiGuidedDeskService from '../workspace/guidedDesk.service.js';
import analyticsService from '../../analytics/analytics.service.js';
import { APIError } from '../../../core/middleware/errorHandler.js';
import { PERSONA_META, DEFAULT_META, defaultActions, personaActions } from '../../../core/config/personas.js';
import { getTierLimit } from '../../../core/config/tierConfig.js';
import {
    AI_ACCESS_EXHAUSTED_MESSAGE,
    CACHE_TTL,
    calculateAICost,
    checkAICreditLimit,
    getAIContext,
    getAIUsageData,
    getOrganizationSettings,
    insightsCache
} from './shared.js';

export const getAIUsageStatus = async (req, res) => {
    const [usage, budget, { data: org }] = await Promise.all([
        getAIUsageData(req.user.organizationId),
        aiService.getBudgetStatus(req.user.id, req.user.organizationId),
        supabase.from('organizations').select('plan_tier').eq('id', req.user.organizationId).single()
    ]);

    const tokenLimit = getTierLimit(org?.plan_tier || 'starter', 'ai_token_limit');

    res.json({
        usage: usage.queries,
        limit: budget.userMax,
        tier: org?.plan_tier || 'starter',
        remaining: budget.userRemaining,
        percent: budget.userMax === Infinity ? 0 : Math.min(100, Math.round((usage.queries / Math.max(1, budget.userMax)) * 100)),
        queryUsage: usage.queries,
        queryLimit: budget.userMax,
        tokenUsage: usage.tokens,
        tokenLimit,
        tokenRemaining: tokenLimit === Infinity ? Infinity : Math.max(0, tokenLimit - usage.tokens)
    });
};

export const getConfig = async (req, res) => {
    const { persona } = req.query;
    const meta = PERSONA_META[persona] || DEFAULT_META;
    const actions = personaActions[persona] || defaultActions;

    res.json({ meta, actions });
};

export const processChat = async (req, res) => {
    const { query, agentId, persona, history, conversationId: incomingConvId } = req.body;

    if (!query) throw new APIError('Query is required', 400);

    const context = await getAIContext(req, persona, agentId, history);
    const response = await aiOrchestratorService.processQuery(query, context);

    const modelUsed = response.provider?.split(':')?.[1] || 'gemini-2.5-flash';
    const { tokens, cost } = calculateAICost(response.usage, modelUsed);

    if (tokens > 0 || cost > 0) {
        await supabase.from('ai_requests').insert([{
            organization_id: req.user.organizationId,
            user_id: req.user.id,
            model_name: modelUsed,
            total_tokens: tokens,
            cost
        }]);
    }

    try {
        let conversationId = incomingConvId;

        if (!conversationId) {
            const { data: newConv, error: convError } = await supabase
                .from('ai_conversations')
                .insert([{
                    organization_id: req.user.organizationId,
                    user_id: req.user.id,
                    title: query.length > 40 ? query.substring(0, 40) + '...' : query
                }])
                .select()
                .single();

            if (convError) throw convError;
            conversationId = newConv.id;
        }

        await supabase.from('ai_chat_messages').insert([
            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'user', content: query },
            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'model', content: response.text, data: response.data || null }
        ]);

        response.conversationId = conversationId;
    } catch (histError) {
        console.error('Failed to save chat history:', histError.message);
    }

    res.json(response);
};

export const processChatStream = async (req, res) => {
    const { query, agentId, persona, history, conversationId: incomingConvId } = req.body;
    let aborted = false;
    let heartbeatTimer = null;

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
        const context = await getAIContext(req, persona, agentId, history);

        if (!query) {
            res.status(400).json({ error: 'Query is required' });
            return;
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Keep-Alive', 'timeout=120');
        res.setHeader('X-Accel-Buffering', 'no');   // nginx: disable buffering
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.flushHeaders();

        req.on('close', () => { aborted = true; });

        // Heartbeat every 5 s — keeps the connection alive and lets the client
        // detect a stalled stream vs a normal network loss.
        heartbeatTimer = setInterval(() => {
            if (!aborted) {
                try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
            }
        }, 5000);

        const stream = aiOrchestratorService.processQueryStream(query, context);

        for await (const chunk of stream) {
            if (aborted) break;

            if (chunk.type === 'token') {
                send({ type: 'token', text: chunk.text });
            } else if (chunk.type === 'gen_ui') {
                send(chunk);
            } else if (chunk.type === 'complete') {
                const modelUsed = chunk.provider?.split(':')?.[1] || 'gemini-2.5-flash';
                const { tokens, cost } = calculateAICost(chunk.usage, modelUsed);

                try {
                    if (tokens > 0 || cost > 0) {
                        await supabase.from('ai_requests').insert([{
                            organization_id: req.user.organizationId,
                            user_id: req.user.id,
                            model_name: modelUsed,
                            total_tokens: tokens,
                            cost
                        }]);
                    }
                } catch (e) {
                    console.error('Stream audit log failed:', e.message);
                }

                let conversationId = incomingConvId;
                try {
                    if (!conversationId) {
                        const { data: newConv } = await supabase
                            .from('ai_conversations')
                            .insert([{
                                organization_id: req.user.organizationId,
                                user_id: req.user.id,
                                title: query.length > 40 ? query.substring(0, 40) + '...' : query
                            }])
                            .select()
                            .single();
                        conversationId = newConv?.id;
                    }

                    if (conversationId) {
                        supabase.from('ai_chat_messages').insert([
                            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'user', content: query },
                            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'model', content: chunk.text }
                        ]).then(() => {}).catch(e => console.error('Stream history save failed:', e.message));
                    }
                } catch (histErr) {
                    console.error('Stream history save failed:', histErr.message);
                }

                send({
                    type: 'complete',
                    text: chunk.text,
                    action: chunk.action,
                    usage: chunk.usage,
                    provider: chunk.provider,
                    conversationId,
                    budget: chunk.budget,
                    data: chunk.data,
                    cached: chunk.cached
                });
            }
        }
    } catch (error) {
        console.error('processChatStream error:', error.message);
        if (!aborted) {
            const userMessage = error.message?.includes('GoogleGenerativeAI') ||
                error.message?.includes('parse stream') ||
                error.message?.includes('fetch failed')
                ? 'The AI service hit a temporary issue. Please try again.'
                : (error.message || 'AI processing failed.');
            send({ type: 'error', message: userMessage });
        }
    } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        res.end();
    }
};

export const getDomainWorkspace = async (req, res) => {
    const { domain } = req.params;
    const view = String(req.query?.view || 'overview');

    if (!aiGuidedDeskService.isSupportedDomain(domain)) {
        throw new APIError('Unsupported AI workspace domain', 400);
    }

    const workspace = await aiGuidedDeskService.getWorkspace(domain, req.user.organizationId, view);
    res.json(workspace);
};

export const magicFill = async (req, res) => {
    const { text } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.status(200).json({
            error: 'AI access unavailable',
            is_limit_reached: true,
            text: AI_ACCESS_EXHAUSTED_MESSAGE,
            provider: 'system:billing_gate'
        });
    }

    if (!text) throw new APIError('Text input is required', 400);

    const parsed = await aiService.parseInvoiceText(text);
    const modelUsed = parsed.provider?.split(':')?.[1] || 'gemini-2.5-flash';
    const { tokens, cost } = calculateAICost(parsed.usage, modelUsed);

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model_name: modelUsed,
        total_tokens: tokens,
        cost
    }]);

    res.json(parsed);
};

export const auditInvoice = async (req, res) => {
    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            riskScore: 0,
            suggestions: ['Audit unavailable on free tier.'],
            is_limit_reached: true
        });
    }

    const audit = await aiService.auditInvoice(req.body, req.user?.id);
    const modelUsed = audit.provider?.split(':')?.[1] || 'gemini-2.5-flash';
    const { tokens, cost } = calculateAICost(audit.usage, modelUsed);

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model_name: modelUsed,
        total_tokens: tokens,
        cost
    }]);

    res.json(audit);
};

export const getInsights = async (req, res) => {
    const orgId = req.user.organizationId;
    const { persona } = req.query;
    const cacheKey = `${orgId}:${persona || 'default'}`;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            data: [],
            is_limit_reached: true,
            text: AI_ACCESS_EXHAUSTED_MESSAGE,
            provider: 'system:billing_gate'
        });
    }

    if (insightsCache.has(cacheKey)) {
        const cached = insightsCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('⚡ Serving cached insights for', cacheKey);
            return res.json(cached.data);
        }
    }

    const [
        invoicesRes,
        customersRes,
        settingsBundle,
        stats,
        revenueTrends,
        customerInsights,
        healthScore,
        safeToSpend,
        personaStats
    ] = await Promise.all([
        Promise.resolve(supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
        Promise.resolve(supabase.from('customers').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
        Promise.resolve(getOrganizationSettings(req.user.organizationId)).catch(() => ({ raw: {}, mapped: {}, currency: 'INR' })),
        analyticsService.getDashboardStats(req.user.organizationId).catch(() => ({})),
        analyticsService.getRevenueTrends(req.user.organizationId, 'monthly').catch(() => ([])),
        analyticsService.getCustomerInsights(req.user.organizationId).catch(() => ([])),
        analyticsService.getBusinessHealthScore(req.user.organizationId).catch(() => ({})),
        analyticsService.getSafeToSpend(req.user.organizationId).catch(() => ({})),
        analyticsService.getPersonaStats(req.user.organizationId, persona || 'solopreneur').catch(() => ({}))
    ]);

    const context = {
        user: req.user,
        organizationId: orgId,
        invoices: invoicesRes?.data || [],
        customers: customersRes?.data || [],
        settings: settingsBundle?.mapped || {},
        currency: settingsBundle?.currency || 'INR',
        stats: stats || {},
        safeToSpend: safeToSpend || {},
        personaStats: personaStats || {},
        trends: Array.isArray(revenueTrends) ? revenueTrends.slice(-6) : [],
        topCustomers: Array.isArray(customerInsights) ? customerInsights.slice(0, 3) : [],
        health: healthScore || {},
        businessType: persona
    };

    const insights = await aiService.generateInsights(context);

    let tokens = 0;
    let cost = 0;
    if (insights.usage) {
        const usageData = calculateAICost(insights.usage, 'gemini-2.5-flash');
        tokens = usageData.tokens;
        cost = usageData.cost;
    }

    insightsCache.set(cacheKey, {
        data: insights,
        timestamp: Date.now()
    });

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model_name: 'gemini-2.5-flash',
        total_tokens: tokens,
        cost
    }]);

    res.json(insights);
};

export const predictRevenue = async (req, res) => {
    const inputData = req.body?.historicalData;

    let historicalData = inputData;
    if (!historicalData || (Array.isArray(historicalData) && historicalData.length === 0)) {
        const { data: invoices } = await supabase
            .from('invoices')
            .select('total, createdAt, status')
            .eq('organization_id', req.user.organizationId)
            .order('createdAt', { ascending: true });

        const safeInvoices = invoices || [];
        historicalData = safeInvoices.reduce((acc, inv) => {
            if (inv.status !== 'paid') return acc;
            const month = new Date(inv.createdAt).toISOString().slice(0, 7);
            acc[month] = (acc[month] || 0) + (inv.total || 0);
            return acc;
        }, {});
    }

    const forecast = aiService.predictRevenue(historicalData);
    res.json(forecast);
};
