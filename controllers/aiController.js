import { supabase } from '../supabase.js';
import aiService from '../services/aiService.js';
import analyticsService from '../services/analyticsService.js';
import emailService from '../services/emailService.js';
import { APIError } from '../middleware/errorHandler.js';

// Cache for insights
const insightsCache = new Map(); // Key: orgId, Value: { data, timestamp }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const PERSONA_META = {
    solopreneur: {
        label: 'SOLO', color: '#34d399', colorDim: '#34d39960',
        colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
        robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
        greeting: "Hey! I'm **Capita**. I'll keep your personal finances organized and your cash flow crystal clear. What's on your mind?"
    },
    subscription: {
        label: 'SaaS', color: '#818cf8', colorDim: '#818cf860',
        colorBg: '#818cf812', colorBorder: '#818cf835', colorGlow: '#818cf830',
        robotColor: '#818cf8', robotEye: '#eef2ff', robotBg: '#1e1b4b',
        greeting: "Systems nominal. **Capita** online — tracking MRR, churn, and subscription health in real time. Ready for your metrics?"
    },
    services_firm: {
        label: 'AGENCY', color: '#fbbf24', colorDim: '#fbbf2460',
        colorBg: '#fbbf2412', colorBorder: '#fbbf2435', colorGlow: '#fbbf2430',
        robotColor: '#fbbf24', robotEye: '#fefce8', robotBg: '#451a03',
        greeting: "Hello! **Capita** here — monitoring retainers, billable hours, and project margins. How can I help today?"
    },
    ecommerce: {
        label: 'COMMERCE', color: '#f472b6', colorDim: '#f472b660',
        colorBg: '#f472b612', colorBorder: '#f472b635', colorGlow: '#f472b630',
        robotColor: '#f472b6', robotEye: '#fdf2f8', robotBg: '#500724',
        greeting: "Inventory secure. **Capita** active — watching replenishment risks and store performance. What do you need?"
    },
};

const DEFAULT_META = {
    label: 'AI', color: '#34d399', colorDim: '#34d39960',
    colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
    robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
    greeting: "Hey! I'm **Capita**, your financial copilot. Ask about revenue, invoices, cash flow, or anything about your business. I'm ready."
};

const defaultActions = [
    { label: 'Revenue today', icon: 'TrendingUp', query: 'What is my total revenue?', tag: 'FINANCE' },
    { label: 'Recent expenses', icon: 'CreditCard', query: 'Show me my last 5 expenses', tag: 'SPEND' },
    { label: 'Draft invoice', icon: 'FileText', query: 'Help me create a new invoice', tag: 'ACTION' },
    { label: 'Business health', icon: 'Zap', query: 'Give me a business health summary', tag: 'OVERVIEW' },
    { label: 'Top customers', icon: 'Users', query: 'Who are my top customers?', tag: 'CRM' },
    { label: 'Net cash flow', icon: 'Activity', query: 'What is my current net cash flow?', tag: 'CASH' },
];

const personaActions = {
    solopreneur: [
        { label: 'Tax estimate', icon: 'Zap', query: 'Estimate my taxes for this quarter', tag: 'TAX' },
        { label: 'Expense check', icon: 'CreditCard', query: 'Show me my expenses for this month', tag: 'SPEND' },
        { label: 'Cash available', icon: 'Activity', query: 'How much cash is safe to spend?', tag: 'CASH' },
        { label: 'Personal vs Biz', icon: 'Users', query: 'Analyze my business spending habits', tag: 'SPLIT' },
    ],
    subscription: [
        { label: 'Check MRR', icon: 'TrendingUp', query: 'What is my current Monthly Recurring Revenue?', tag: 'MRR' },
        { label: 'Churn report', icon: 'Users', query: 'Analyze my customer churn', tag: 'CHURN' },
        { label: 'Growth rate', icon: 'Activity', query: 'What is my revenue growth month-over-month?', tag: 'GROWTH' },
        { label: 'LTV analysis', icon: 'Zap', query: 'What is the average customer lifetime value?', tag: 'LTV' },
    ],
    services_firm: [
        { label: 'Project profit', icon: 'TrendingUp', query: 'Which projects are most profitable?', tag: 'P&L' },
        { label: 'Unbilled work', icon: 'Clock', query: 'Show me all unbilled hours', tag: 'HOURS' },
        { label: 'Retainer risks', icon: 'AlertTriangle', query: 'Are any client retainers nearly empty?', tag: 'RISK' },
        { label: 'Burn rate', icon: 'Activity', query: 'What is our current monthly burn rate?', tag: 'BURN' },
    ],
    ecommerce: [
        { label: 'Stock risks', icon: 'AlertTriangle', query: 'Which products are at risk of stockout?', tag: 'RISK' },
        { label: 'Dead stock', icon: 'Zap', query: 'How much capital is locked in dead stock?', tag: 'LOCK' },
        { label: 'Refund rate', icon: 'RotateCcw', query: 'What is my current refund rate?', tag: 'REFUND' },
        { label: 'Sales velocity', icon: 'TrendingUp', query: 'Which items are selling fastest today?', tag: 'VELOCITY' },
    ],
};

export const getConfig = async (req, res) => {
    const { persona } = req.query;
    const meta = PERSONA_META[persona] || DEFAULT_META;
    const actions = personaActions[persona] || defaultActions;

    res.json({ meta, actions });
};

export const processChat = async (req, res) => {
    const { query, agentId, persona } = req.body;

    if (!query) {
        throw new APIError('Query is required', 400);
    }

    // Get context data - Parallel Config
    const [
        { data: invoices },
        { data: customers },
        { data: products },
        { data: expenses },
        stats
    ] = await Promise.all([
        supabase.from('invoices').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('customers').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('products').select('*').eq('organization_id', req.user.organizationId),
        supabase.from('expenses').select('*').eq('organization_id', req.user.organizationId).order('date', { ascending: false }).limit(20),
        analyticsService.getDashboardStats(req.user.organizationId) // Pass orgId to stats
    ]);

    const context = { invoices, customers, products, expenses, stats, agentId, businessType: persona };

    const response = await aiService.processQuery(query, context);

    // [AUDIT] Log AI Request
    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model: 'gemini-2.0-flash-lite',
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
        tokens: 50,
        cost: 0
    }]);

    res.json(action);
};

export const generateCollectionDraft = async (req, res) => {
    const { invoiceId, forceAggressive } = req.body;

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

    const draft = await aiService.generateCollectionDraft(invoice, forceAggressive);
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
