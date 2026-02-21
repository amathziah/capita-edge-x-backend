import { supabase } from '../supabase.js';
import aiService from '../services/aiService.js';
import analyticsService from '../services/analyticsService.js';
import { APIError } from '../middleware/errorHandler.js';

// Cache for insights
const insightsCache = new Map(); // Key: orgId, Value: { data, timestamp }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export const processChat = async (req, res) => {
    const { query, agentId } = req.body;

    if (!query) {
        throw new APIError('Query is required', 400);
    }

    // Get context data - Parallel Config
    const [
        { data: invoices },
        { data: customers },
        { data: products },
        stats
    ] = await Promise.all([
        supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('customers').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('products').select('*').eq('organization_id', req.user.organizationId),
        analyticsService.getDashboardStats(req.user.organizationId) // Pass orgId to stats
    ]);

    const context = { invoices, customers, products, stats, agentId };
    const response = await aiService.processQuery(query, context);

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-pro',
        "promptDetails": { query, type: 'chat' },
        tokens: 100, // Estimate
        cost: 0
    }]);

    res.json(response);
};

export const magicFill = async (req, res) => {
    const { text } = req.body;
    if (!text) throw new APIError('Text input is required', 400);

    const parsed = await aiService.parseInvoiceText(text);

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-pro',
        "promptDetails": { type: 'magic-fill' },
        tokens: 150,
        cost: 0
    }]);

    res.json(parsed);
};

export const getInsights = async (req, res) => {
    const orgId = req.user.organizationId;

    // Check Cache
    if (insightsCache.has(orgId)) {
        const cached = insightsCache.get(orgId);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            console.log('⚡ Serving cached insights for', orgId);
            return res.json(cached.data);
        }
    }

    const [
        { data: invoices },
        { data: products },
        { data: customers },
        stats,
        revenueTrends,
        productPerformance,
        customerInsights,
        healthScore
    ] = await Promise.all([
        supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('products').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('customers').select('*').eq('organization_id', req.user.organizationId),
        analyticsService.getDashboardStats(req.user.organizationId),
        analyticsService.getRevenueTrends(req.user.organizationId, 'monthly'),
        analyticsService.getProductPerformance(req.user.organizationId),
        analyticsService.getCustomerInsights(req.user.organizationId),
        analyticsService.getBusinessHealthScore(req.user.organizationId)
    ]);

    const context = {
        invoices,
        products,
        customers,
        stats,
        trends: revenueTrends.slice(-6), // Last 6 months
        topProducts: productPerformance.slice(0, 3),
        topCustomers: customerInsights.slice(0, 3),
        health: healthScore
    };
    const insights = await aiService.generateInsights(context);

    // Save to Cache
    insightsCache.set(orgId, {
        data: insights,
        timestamp: Date.now()
    });

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-pro',
        "promptDetails": { type: 'insights' },
        tokens: 300,
        cost: 0
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

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select('*, customers(name, email)')
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId) // Tenant Check
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    const offer = await aiService.generateSettlementOffer(invoice);

    // [AUDIT] Log
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-pro',
        "promptDetails": { type: 'settlement', invoiceId },
        tokens: 200,
        cost: 0
    }]);

    res.json(offer);
};

export const processCommand = async (req, res) => {
    const { command } = req.body;
    if (!command) throw new APIError('Command text required', 400);

    const action = await aiService.parseCommand(command);

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-pro',
        "promptDetails": { type: 'voice_command' },
        tokens: 50,
        cost: 0
    }]);

    res.json(action);
};
