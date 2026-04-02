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
    
    const pricing = AI_PRICING[model] || AI_PRICING['gemini-2.5-flash'] || AI_PRICING['gemini-2.0-flash'];
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

const checkAICreditLimit = async (req) => {
    // Usage tracking continues for analytics, but limit enforcement is temporarily lifted
    const totalTokens = await getAIUsageData(req.user.organizationId);
    
    // Always allowed for now as requested
    return { 
        allowed: true, 
        limit: Infinity, 
        usage: totalTokens 
    };
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

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            text: "🚀 **AI Credit Limit Reached**\n\nYou've used your assigned tokens for this period. To continue getting personal CFO insights and automated support, please upgrade to a higher plan.",
            is_limit_reached: true,
            usage: {
                totalTokenCount: creditStatus.usage,
                limit: creditStatus.limit
            },
            action: { type: 'navigate', data: { to: '/settings/billing' } },
            provider: 'system:billing_gate'
        });
    }

    if (!query) {
        throw new APIError('Query is required', 400);
    }

    // Get context data - Parallel Robust Config with Safe-Defaults
    const [
        invoicesRes,
        customersRes,
        expensesRes,
        stats,
        safeToSpend,
        customerInsights,
        personaStats,
        revenueTrends,
        paymentsRes,
        settingsRes
    ] = await Promise.all([
        Promise.resolve(supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId).order('created_at', { ascending: false }).limit(20)).catch(err => { console.error('AI Context Error (Invoices):', err); return { data: [] }; }),
        Promise.resolve(supabase.from('customers').select('*').eq('organization_id', req.user.organizationId)).catch(err => { console.error('AI Context Error (Customers):', err); return { data: [] }; }),
        Promise.resolve(supabase.from('expenses').select('*').eq('organization_id', req.user.organizationId).order('date', { ascending: false }).limit(20)).catch(err => { console.error('AI Context Error (Expenses):', err); return { data: [] }; }),
        analyticsService.getDashboardStats(req.user.organizationId).catch(err => { console.error('AI Context Error (Stats):', err); return {}; }),
        analyticsService.getSafeToSpend(req.user.organizationId).catch(err => { console.error('AI Context Error (SafeToSpend):', err); return {}; }),
        analyticsService.getCustomerInsights(req.user.organizationId).catch(err => { console.error('AI Context Error (CustomerInsights):', err); return []; }),
        analyticsService.getPersonaStats(req.user.organizationId, persona || 'solopreneur').catch(err => { console.error('AI Context Error (PersonaStats):', err); return {}; }),
        analyticsService.getRevenueTrends(req.user.organizationId, 'monthly').catch(err => { console.error('AI Context Error (RevenueTrends):', err); return []; }),
        Promise.resolve(supabase.from('payments').select('*, customers(name)').eq('organization_id', req.user.organizationId).order('date', { ascending: false }).limit(10)).catch(err => { console.error('AI Context Error (Payments):', err); return { data: [] }; }),
        Promise.resolve(supabase.from('settings').select('*').eq('organization_id', req.user.organizationId).maybeSingle()).catch(err => { console.error('AI Context Error (Settings):', err); return { data: {} }; })
    ]);

    // ──── High-Fidelity Context Computation ────────────────────────────────────
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthKey = now.getMonth() === 0 
        ? `${now.getFullYear() - 1}-12` 
        : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

    // 1. Calculate Ageing Report
    const ageing = {
        current: 0,    // 0-30 days
        near: 0,       // 31-60 days
        critical: 0,   // 61+ days
        totalOverdue: 0
    };

    (invoicesRes?.data || []).filter(inv => inv.status === 'overdue').forEach(inv => {
        const dueDate = new Date(inv.dueDate);
        const diffDays = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
        ageing.totalOverdue += inv.total;
        if (diffDays <= 30) ageing.current += inv.total;
        else if (diffDays <= 60) ageing.near += inv.total;
        else ageing.critical += inv.total;
    });

    // 2. Calculate Growth (MoM)
    const currentMonthData = (revenueTrends || []).find(t => t.period === currentMonthKey);
    const lastMonthData = (revenueTrends || []).find(t => t.period === lastMonthKey);
    const momGrowth = lastMonthData?.revenue > 0 
        ? ((currentMonthData?.revenue || 0) - lastMonthData.revenue) / lastMonthData.revenue * 100 
        : 0;

    // 3. Deep Context Metrics for Strategic Advisory
    const totalCash = (paymentsRes?.data || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    const avgMonthlyExpenses = (revenueTrends || []).slice(-6).reduce((sum, t) => sum + (t.expenses || 0), 0) / Math.max(1, Math.min(6, revenueTrends?.length || 1));
    const runwayMonths = avgMonthlyExpenses > 0 ? totalCash / avgMonthlyExpenses : (totalCash > 0 ? 99 : 0);

    const totalRevenue = stats?.total_revenue || 1; // Prevent div by zero
    const customerRecs = Array.isArray(customerInsights) ? customerInsights : [];
    const topClients = customerRecs.slice(0, 3).map(c => ({
        name: c.name,
        revenue: c.total_revenue,
        percentage: (c.total_revenue / totalRevenue) * 100
    }));
    const maxConcentration = topClients.length > 0 ? Math.max(...topClients.map(c => c.percentage)) : 0;

    const riskyOverdue = (invoicesRes?.data || [])
        .filter(inv => inv.status === 'overdue')
        .map(inv => {
            const dueDate = new Date(inv.dueDate);
            const daysLate = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
            return { invoiceNumber: inv.invoiceNumber, daysLate, total: inv.total };
        })
        .sort((a, b) => b.daysLate - a.daysLate);

    const deepContext = {
        liquidity: {
            totalCash,
            runwayMonths: runwayMonths > 99 ? '99+' : runwayMonths.toFixed(1),
            burnRate: avgMonthlyExpenses.toFixed(0)
        },
        risk: {
            maxConcentration: maxConcentration.toFixed(1),
            topClients,
            riskyOverdue: riskyOverdue.slice(0, 3)
        },
        growth: {
            dormantClients: customerRecs
                .filter(c => {
                    if (!c.last_invoice_date) return true;
                    const lastInv = new Date(c.last_invoice_date);
                    return (now - lastInv) / (1000 * 60 * 60 * 24) > 90;
                })
                .map(c => c.name)
                .slice(0, 3)
        }
    };

    const realSettings = settingsRes?.data || {};
    const currency = realSettings?.currency || 'INR';
    const planTier = realSettings?.plan_tier || req.user?.plan_tier || 'starter';

    const context = { 
        user: req.user,
        organizationId: req.user.organizationId,
        currency,
        planTier,
        temporal: {
            currentTime: now.toISOString(),
            currentDay: dayOfWeek,
            fiscalYear: now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`
        },
        invoices: Array.isArray(invoicesRes?.data) ? invoicesRes.data : [], 
        customers: Array.isArray(customersRes?.data) ? customersRes.data : [], 
        expenses: Array.isArray(expensesRes?.data) ? expensesRes.data : [], 
        payments: Array.isArray(paymentsRes?.data) ? paymentsRes.data : [],
        settings: realSettings,
        stats: stats || {}, 
        safeToSpend: safeToSpend || {},
        ageing,
        growth: { momGrowth },
        deepContext,
        customerInsights: Array.isArray(customerInsights) ? customerInsights : [],
        personaStats: personaStats || {},
        revenueTrends: Array.isArray(revenueTrends) ? revenueTrends.slice(-12) : [], 
        agentId, 
        businessType: persona || realSettings?.business_type || 'solopreneur',
        history: req.body.history || []
    };

    const response = await aiService.processQuery(query, context);
    const modelUsed = response.provider?.split(':')?.[1] || 'gemini-3-flash-preview';
    const { tokens, cost } = calculateAICost(response.usage, modelUsed);

    // [AUDIT] Log AI Request with precision data
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: modelUsed,
        tokens,
        cost
    }]);

    // [HISTORY] Save User Message and AI Response
    try {
        await supabase.from('ai_chat_messages').insert([
            { organization_id: req.user.organizationId, user_id: req.user.id, role: 'user', content: query },
            { organization_id: req.user.organizationId, user_id: req.user.id, role: 'model', content: response.text, data: response.data || null }
        ]);
    } catch (histError) {
        console.error('Failed to save chat history:', histError.message);
        // Don't fail the request if history save fails
    }

    res.json(response);
};

export const magicFill = async (req, res) => {
    const { text } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.status(200).json({
            error: "AI Credit Limit Reached",
            is_limit_reached: true,
            text: "Upgrade your plan to use Magic Fill.",
            provider: 'system:billing_gate'
        });
    }

    if (!text) throw new APIError('Text input is required', 400);

    const parsed = await aiService.parseInvoiceText(text);
    const modelUsed = parsed.provider?.split(':')?.[1] || 'gemini-3-flash-preview';
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

export const auditInvoice = async (req, res) => {
    const { items, customerName, total } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            riskScore: 0,
            suggestions: ["Audit unavailable on free tier."],
            is_limit_reached: true
        });
    }

    const audit = await aiService.auditInvoice(req.body, req.user?.id);
    const modelUsed = audit.provider?.split(':')?.[1] || 'gemini-3-flash-preview';
    const { tokens, cost } = calculateAICost(audit.usage, modelUsed);

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: modelUsed,
        tokens,
        cost
    }]);

    res.json(audit);
};

export const getInsights = async (req, res) => {
    const orgId = req.user.organizationId;
    const { persona } = req.query;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            data: [],
            is_limit_reached: true,
            text: "Please upgrade your plan to generate business insights.",
            provider: 'system:billing_gate'
        });
    }

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

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: "AI Credit Limit Reached",
            is_limit_reached: true,
            text: "Please upgrade your plan to use AI negotiation features.",
            provider: 'system:billing_gate'
        });
    }

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

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: "AI Credit Limit Reached",
            is_limit_reached: true,
            text: "Please upgrade your plan to use AI command processing.",
            provider: 'system:billing_gate'
        });
    }

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

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: "AI Credit Limit Reached",
            is_limit_reached: true,
            text: "Please upgrade your plan to generate AI collection drafts.",
            provider: 'system:billing_gate'
        });
    }

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

export const getChatHistory = async (req, res) => {
    const { data, error } = await supabase
        .from('ai_chat_messages')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw error;
    
    // Reverse to get chronological order for the UI
    res.json(data.reverse().map(msg => ({
        id: msg.id,
        sender: msg.role === 'user' ? 'user' : 'bot',
        text: msg.content,
        data: msg.data,
        timestamp: msg.created_at
    })));
};

export const deleteChatHistory = async (req, res) => {
    const { error } = await supabase
        .from('ai_chat_messages')
        .delete()
        .eq('organization_id', req.user.organizationId)
        .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ success: true });
};

export const getBudget = async (req, res) => {
    const userId = req.user?.id || 'anon';
    const budget = aiService.getBudgetStatus(userId);
    res.json(budget);
};
