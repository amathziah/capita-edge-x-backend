import { supabase } from '../../core/database/supabase.js';
import aiService from './ai.service.js';
import analyticsService from '../analytics/analytics.service.js';
import emailService from '../../core/services/email.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { LIMITS } from '../../core/config/constants.js';
import { PERSONA_META, DEFAULT_META, defaultActions, personaActions } from '../../core/config/personas.js';

// Cache for insights
// Cache for insights
import { AI_PRICING, EXCHANGE_RATE, getTierLimit } from '../../core/config/tierConfig.js';

// Cache for insights
const insightsCache = new Map(); // Key: orgId, Value: { data, timestamp }
const CACHE_TTL = LIMITS.AI_CACHE_TTL_MS; // Moved to constants

/**
 * Helper to calculate cost in INR
 */
const calculateAICost = (usage, model = 'gemini-2.0-flash') => {
    if (!usage) return { tokens: 0, cost: 0 };
    
    const pricing = AI_PRICING[model] || AI_PRICING['gemini-2.0-flash'];
    const { promptTokenCount = 0, candidatesTokenCount = 0, totalTokenCount = 0 } = usage;
    
    const usdCost = (promptTokenCount * pricing.inputPer1M / 1000000) + 
                    (candidatesTokenCount * pricing.outputPer1M / 1000000);
    
    return {
        tokens: totalTokenCount,
        cost: usdCost * EXCHANGE_RATE.USD_TO_INR
    };
};

/**
 * Aggregates total token usage for an organization
 */
const getAIUsageData = async (organizationId) => {
    const { data, error } = await supabase
        .from('ai_requests')
        .select('tokens')
        .eq('organization_id', organizationId);

    if (error) return 0;
    return data.reduce((sum, req) => sum + (req.tokens || 0), 0);
};

/**
 * Enforces credit limits based on organization tier
 */
const checkAICreditLimit = async (req) => {
    // 1. Get organization tier
    const { data: org, error: orgError } = await supabase
        .from('organizations')
        .select('plan_tier')
        .eq('id', req.user.organizationId)
        .single();

    if (orgError || !org) {
        // If organization is missing, treat as Starter for safety
        console.warn(`[AI] Organization ${req.user.organizationId} not found. Defaulting to Starter limits.`);
        const limit = getTierLimit('starter', 'ai_token_limit');
        const totalTokens = await getAIUsageData(req.user.organizationId);
        if (totalTokens >= limit) throw new APIError('AI Limit Exceeded (Starter)', 403);
        return;
    }

    const limit = getTierLimit(org.plan_tier, 'ai_token_limit');
    if (limit === Infinity) return; // Enterprise/Unlimited

    // 2. Get current usage
    const totalTokens = await getAIUsageData(req.user.organizationId);

    if (totalTokens >= limit) {
        throw new APIError(`AI Credit Limit Exceeded (${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens). Please upgrade your plan to continue using AI features.`, 403);
    }
};

export const getAIUsageStatus = async (req, res) => {
    const [usage, { data: org }] = await Promise.all([
        getAIUsageData(req.user.organizationId),
        supabase.from('organizations').select('plan_tier').eq('id', req.user.organizationId).single()
    ]);

    const limit = getTierLimit(org?.plan_tier || 'starter', 'ai_token_limit');

    res.json({
        usage,
        limit,
        tier: org?.plan_tier || 'starter',
        remaining: limit === Infinity ? Infinity : Math.max(0, limit - usage),
        percent: limit === Infinity ? 0 : Math.min(100, Math.round((usage / limit) * 100))
    });
};



export const getConfig = async (req, res) => {
    const { persona } = req.query;
    const meta = PERSONA_META[persona] || DEFAULT_META;
    const actions = personaActions[persona] || defaultActions;

    res.json({ meta, actions });
};

export const processChat = async (req, res) => {
    const { query, agentId, persona } = req.body;

    await checkAICreditLimit(req);

    if (!query) {
        throw new APIError('Query is required', 400);
    }

    // Get context data - Parallel Robust Config
    const [
        invoicesRes,
        customersRes,
        expensesRes,
        stats,
        safeToSpend,
        customerInsights,
        personaStats,
        revenueTrends
    ] = await Promise.all([
        Promise.resolve(supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
        Promise.resolve(supabase.from('customers').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
        Promise.resolve(supabase.from('expenses').select('*').eq('organization_id', req.user.organizationId).order('date', { ascending: false }).limit(50)).catch(() => ({ data: [] })),
        analyticsService.getDashboardStats(req.user.organizationId).catch(() => ({})),
        analyticsService.getSafeToSpend(req.user.organizationId).catch(() => ({})),
        analyticsService.getCustomerInsights(req.user.organizationId).catch(() => ([])),
        analyticsService.getPersonaStats(req.user.organizationId, persona || 'solopreneur').catch(() => ({})),
        analyticsService.getRevenueTrends(req.user.organizationId, 'monthly').catch(() => ([]))
    ]);

    const context = { 
        user: req.user,
        invoices: invoicesRes?.data || [], 
        customers: customersRes?.data || [], 
        expenses: expensesRes?.data || [], 
        stats: stats || {}, 
        safeToSpend: safeToSpend || {},
        customerInsights: Array.isArray(customerInsights) ? customerInsights : [],
        personaStats: personaStats || {},
        revenueTrends: Array.isArray(revenueTrends) ? revenueTrends.slice(-12) : [], // Safeguard slice
        agentId, 
        businessType: persona 
    };

    const response = await aiService.processQuery(query, context);
    const modelUsed = response.provider?.split(':')?.[1] || 'gemini-3.1-flash-preview';
    const { tokens, cost } = calculateAICost(response.usage, modelUsed);

    // [AUDIT] Log AI Request with precision data
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: modelUsed,
        tokens,
        cost
    }]);

    res.json(response);
};

export const magicFill = async (req, res) => {
    const { text } = req.body;

    await checkAICreditLimit(req);

    if (!text) throw new APIError('Text input is required', 400);

    const parsed = await aiService.parseInvoiceText(text);
    const modelUsed = parsed.provider?.split(':')?.[1] || 'gemini-3.1-flash-preview';
    const { tokens, cost } = calculateAICost(parsed.usage, modelUsed);

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: modelUsed,
        tokens,
        cost
    }]);

    res.json(parsed);
};

export const getInsights = async (req, res) => {
    const orgId = req.user.organizationId;
    const { persona } = req.query;

    await checkAICreditLimit(req);

    // Check Cache
    if (insightsCache.has(orgId)) {
        const cached = insightsCache.get(orgId);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('⚡ Serving cached insights for', orgId);
            return res.json(cached.data);
        }
    }

    const [
        invoicesRes,
        customersRes,
        stats,
        revenueTrends,
        customerInsights,
        healthScore,
        safeToSpend,
        personaStats
    ] = await Promise.all([
        Promise.resolve(supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
        Promise.resolve(supabase.from('customers').select('*').eq('organization_id', req.user.organizationId)).catch(() => ({ data: [] })),
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
        stats: stats || {},
        safeToSpend: safeToSpend || {},
        personaStats: personaStats || {},
        trends: Array.isArray(revenueTrends) ? revenueTrends.slice(-6) : [], // Safeguard slice
        topCustomers: Array.isArray(customerInsights) ? customerInsights.slice(0, 3) : [], // Safeguard slice
        health: healthScore || {},
        businessType: persona
    };
    
    const insights = await aiService.generateInsights(context);
    
    let tokens = 0;
    let cost = 0;
    if (insights.usage) {
        const usageData = calculateAICost(insights.usage, 'gemini-2.0-flash');
        tokens = usageData.tokens;
        cost = usageData.cost;
    }

    // Save to Cache
    insightsCache.set(orgId, {
        data: insights,
        timestamp: Date.now()
    });

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-2.0-flash',
        tokens,
        cost
    }]);

    res.json(insights);
};

export const predictRevenue = async (req, res) => {
    // 1. Get historical invoice data
    const { data: invoices } = await supabase
        .from('invoices')
        .select('total, created_at, status')
        .eq('organization_id', req.user.organizationId)
        .order('created_at', { ascending: true });

    // 2. Format for AI analysis
    const historicalData = invoices.reduce((acc, inv) => {
        const month = new Date(inv.created_at).toISOString().slice(0, 7); // YYYY-MM
        acc[month] = (acc[month] || 0) + inv.total;
        return acc;
    }, {});

    const forecast = aiService.predictRevenue(historicalData); // This is mock in aiService but wired up
    res.json(forecast);
};

export const negotiateSettlement = async (req, res) => {
    const { invoiceId } = req.body;

    await checkAICreditLimit(req);

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select('*, customers(name, email)')
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId) // Tenant Check
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    const offer = await aiService.generateSettlementOffer(invoice);
    const { tokens, cost } = calculateAICost(offer?.usage, 'gemini-2.0-flash');

    // [AUDIT] Log with Customer Attribution
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        customer_id: invoice.customer_id,
        model: 'gemini-2.0-flash',
        tokens,
        cost
    }]);

    res.json(offer);
};

export const processCommand = async (req, res) => {
    const { command } = req.body;

    await checkAICreditLimit(req);

    if (!command) throw new APIError('Command text required', 400);

    const action = await aiService.parseCommand(command);
    const { tokens, cost } = calculateAICost(action.usage, 'gemini-2.0-flash');

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-2.0-flash',
        tokens,
        cost
    }]);

    res.json(action);
};

export const generateCollectionDraft = async (req, res) => {
    const { invoiceId, forceAggressive } = req.body;

    await checkAICreditLimit(req);

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            customers (name, email)
        `)
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    const draft = await aiService.generateCollectionDraft(invoice, 'INR', forceAggressive);
    const { tokens, cost } = calculateAICost(draft.usage, 'gemini-2.0-flash');

    // [AUDIT] Log with Customer Attribution
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        customer_id: invoice.customer_id,
        model: 'gemini-2.0-flash',
        tokens,
        cost
    }]);

    res.json(draft);
};

export const sendCollectionReminder = async (req, res) => {
    const { invoiceId, subject, body } = req.body;

    // 1. Get invoice and organization settings
    const [
        { data: invoice, error: invError },
        { data: settings, error: setError }
    ] = await Promise.all([
        supabase.from('invoices').select('*, customers(email, name)').eq('id', invoiceId).eq('organization_id', req.user.organizationId).single(),
        supabase.from('settings').select('*').eq('organization_id', req.user.organizationId).single()
    ]);

    if (invError || !invoice) throw new APIError('Invoice not found', 404);

    // 2. Determine recipient email
    const recipientEmail = invoice.customers?.email;
    if (!recipientEmail) throw new APIError('Customer email not found', 400);

    // 3. Send email via SMTP
    const htmlBody = body.replace(/\n/g, '<br/>'); // Simple text to HTML
    const result = await emailService.sendCustomEmail(
        recipientEmail,
        subject,
        `<html><body>${htmlBody}</body></html>`,
        settings || {}
    );

    // 4. Log the activity (optional but good)
    await supabase.from('notifications').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        type: 'reminder_sent',
        message: `AI Collection reminder sent to ${invoice.customers.name} for Invoice #${invoice.invoiceNumber}`,
        metadata: { invoiceId, subject }
    }]);

    res.json({ success: true, sentAt: new Date().toISOString() });
};
