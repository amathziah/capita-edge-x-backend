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



/**
 * Helper to gather minimal base financial context for the AI.
 * Heavy data fetching is now deferred to Gemini Native Tools (Function Calling).
 */
const getAIContext = async (req, persona, agentId, history) => {
    // Only fetch basic org settings
    let realSettings = {};
    try {
        const settingsRes = await supabase.from('settings')
            .select('*')
            .eq('organization_id', req.user.organizationId)
            .maybeSingle();
        if (settingsRes?.data) {
            realSettings = settingsRes.data;
        }
    } catch (err) {
        console.error('AI Context Error (Settings):', err); 
    }

    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    
    const currency = realSettings?.currency || 'INR';
    const planTier = realSettings?.plan_tier || req.user?.plan_tier || 'starter';
    const businessType = persona || realSettings?.business_type || 'solopreneur';

    return { 
        user: req.user,
        organizationId: req.user.organizationId,
        currency,
        planTier,
        businessType,
        temporal: {
            currentTime: now.toISOString(),
            currentDay: dayOfWeek,
            fiscalYear: now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`
        },
        settings: realSettings,
        history: history || [],
        agentId,
        // Empty arrays/objects as placeholders so legacy destructuring doesn't break
        // while we transition fully to tools.
        invoices: [], 
        customers: [], 
        expenses: [], 
        payments: [],
        stats: {}, 
        safeToSpend: {},
        ageing: {},
        growth: {},
        deepContext: {},
        customerInsights: [],
        personaStats: {},
        revenueTrends: []
    };
};

export const processChat = async (req, res) => {
    const { query, agentId, persona, history, conversationId: incomingConvId } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            text: "🚀 **AI Credit Limit Reached**\n\nYou've used your assigned tokens for this period. Please upgrade to continue.",
            is_limit_reached: true,
            provider: 'system:billing_gate'
        });
    }

    if (!query) throw new APIError('Query is required', 400);

    const context = await getAIContext(req, persona, agentId, history);
    const response = await aiService.processQuery(query, context);

    const modelUsed = response.provider?.split(':')?.[1] || 'gemini-2.5-flash';
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

/**
 * Streams AI response tokens to the client via Server-Sent Events (SSE).
 * The frontend can read these incrementally using the EventSource API or fetch + ReadableStream.
 *
 * Event types sent:
 *  - data: {"type":"token","text":"..."}   → incremental chunk
 *  - data: {"type":"complete","text":"...",...}  → final payload after stream ends
 *  - data: {"type":"error","message":"..."}  → on failure
 */
export const processChatStream = async (req, res) => {
    const { query, agentId, persona, history, conversationId: incomingConvId } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI Credit Limit Reached. Please upgrade your plan.' })}\n\n`);
        res.end();
        return;
    }

    if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
    }

    // ── SSE Headers ──────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering if used
    res.flushHeaders();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    // Handle client disconnect
    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
        const context = await getAIContext(req, persona, agentId, history);
        const stream = aiService.processQueryStream(query, context);

        let fullText = '';

        for await (const chunk of stream) {
            if (aborted) break;

            if (chunk.type === 'token') {
                fullText += chunk.text;
                send({ type: 'token', text: chunk.text });
            } else if (chunk.type === 'gen_ui') {
                send(chunk);
            } else if (chunk.type === 'complete') {
                // ── Post-stream: Audit + History ──────────────────────────────
                const modelUsed = chunk.provider?.split(':')?.[1] || 'gemini-2.5-flash';
                const { tokens, cost } = calculateAICost(chunk.usage, modelUsed);

                try {
                    await supabase.from('ai_requests').insert([{
                        organization_id: req.user.organizationId,
                        user_id: req.user.id,
                        model: modelUsed,
                        tokens,
                        cost
                    }]);
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
                        await supabase.from('ai_chat_messages').insert([
                            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'user', content: query },
                            { organization_id: req.user.organizationId, user_id: req.user.id, conversation_id: conversationId, role: 'model', content: chunk.text }
                        ]);
                    }
                } catch (histErr) {
                    console.error('Stream history save failed:', histErr.message);
                }

                // Send final event with all metadata
                send({
                    type: 'complete',
                    text: chunk.text,
                    action: chunk.action,
                    usage: chunk.usage,
                    provider: chunk.provider,
                    conversationId,
                    budget: chunk.budget
                });
            }
        }
    } catch (error) {
        console.error('processChatStream error:', error.message);
        if (!aborted) {
            send({ type: 'error', message: error.message || 'AI processing failed.' });
        }
    } finally {
        res.end();
    }
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

export const getConversations = async (req, res) => {
    const results = [];
    
    // 1. Check for orphaned messages (legacy history) first as it's the most stable table
    try {
        const { count, error: countError } = await supabase
            .from('ai_chat_messages')
            .select('*', { count: 'exact', head: true })
            .is('conversation_id', null)
            .eq('user_id', req.user.id);

        if (!countError && count > 0) {
            results.push({
                id: 'legacy',
                title: 'My Previous History',
                created_at: new Date().toISOString()
            });
        }
    } catch (e) {
        console.error('Legacy check failed:', e.message);
    }

    // 2. Try to fetch new conversations from the new table
    try {
        const { data, error } = await supabase
            .from('ai_conversations')
            .select('*')
            .eq('organization_id', req.user.organizationId)
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(30);

        if (!error && data) {
            results.unshift(...data);
        }
    } catch (err) {
        console.warn('Conversations table may not exist yet:', err.message);
    }

    res.json(results);
};

export const getConversationMessages = async (req, res) => {
    const { id } = req.params;
    
    try {
        let query = supabase
            .from('ai_chat_messages')
            .select('*')
            .order('created_at', { ascending: true });

        if (id === 'legacy') {
            query = query.is('conversation_id', null).eq('user_id', req.user.id);
        } else {
            query = query.eq('conversation_id', id);
        }

        const { data, error } = await query;
        
        if (error) {
            console.warn('Failed to fetch messages:', error.message);
            return res.json([]);
        }
        
        res.json((data || []).map(msg => ({
            id: msg.id,
            sender: msg.role === 'user' ? 'user' : 'bot',
            text: msg.content,
            data: msg.data,
            timestamp: msg.created_at
        })));
    } catch (err) {
        console.error('getConversationMessages crash prevented:', err.message);
        res.json([]);
    }
};

export const getChatHistory = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('ai_chat_messages')
            .select('*')
            .eq('organization_id', req.user.organizationId)
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.warn('getChatHistory failed:', error.message);
            return res.json([]);
        }
        
        // Reverse to get chronological order for the UI
        res.json((data || []).reverse().map(msg => ({
            id: msg.id,
            sender: msg.role === 'user' ? 'user' : 'bot',
            text: msg.content,
            data: msg.data,
            timestamp: msg.created_at
        })));
    } catch (err) {
        console.error('getChatHistory crash prevented:', err.message);
        res.json([]);
    }
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
