import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { formatCurrency, getCurrencySymbol } from '../../core/utils/formatting.js';
import { supabase } from '../../core/database/supabase.js';
import analyticsService from '../analytics/analytics.service.js';
import { PLAN_TIERS } from '../../core/config/tierConfig.js';

dotenv.config();

/**
 * AI Service using Google Gemini API
 * 
 * Strategy:
 * 1. Tier-aware model routing (limits from tierConfig.js — single source of truth)
 * 2. TTL-based LRU response cache
 * 3. Monthly plan budget (enforced via Supabase ai_requests table)
 * 4. Token bucket rate limiter (prevents Gemini 429s)
 * 5. Rule-based insights (zero API calls)
 * 6. Request deduplication + circuit breaker
 */
class AIService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        this.apiKey = apiKey;
        this.pendingRequests = new Map();
        this.circuitStatus = { open: false, until: 0 };

        // ═══════════════════════════════════════════════════════
        // RESPONSE CACHE — TTL-based, LRU eviction
        // ═══════════════════════════════════════════════════════
        this.cache = new Map(); // key → { data, expiresAt }
        this.CACHE_MAX_SIZE = 200;
        this.CACHE_TTL = {
            chat: 5 * 60 * 1000,       // 5 minutes for chat
            insights: 30 * 60 * 1000,   // 30 minutes for insights
            invoice: 10 * 60 * 1000,    // 10 minutes for invoice parse
            draft: 15 * 60 * 1000,      // 15 minutes for collection drafts
        };

        // ═══════════════════════════════════════════════════════
        // RATE LIMITER — Token Bucket
        // ═══════════════════════════════════════════════════════
        this.rateBucket = {
            tokens: 60,
            maxTokens: 60,
            refillRate: 15,        // 15 tokens per minute (Gemini free-tier safe)
            lastRefill: Date.now(),
        };

        // ═══════════════════════════════════════════════════════
        // TIER CONFIG — Same model quality for ALL tiers.
        // Strategy: Gate by FEATURES + QUERY COUNT, not model intelligence.
        // Free users get amazing answers → converts to paid.
        // With a target of 25 early customers, we can confidently run
        // the newest 'gemini-3-flash' model (10K RPD limit) for everyone.
        // ═══════════════════════════════════════════════════════
        this.tierModels = {
            starter: ['gemini-2.5-flash'],
            free:    ['gemini-2.5-flash'],
            solo:    ['gemini-2.5-flash'],
            solo_pro: ['gemini-2.5-flash'],
            enterprise: ['gemini-2.5-flash'],
        };

        // Defaults/Fallback
        this.models = ['gemini-2.5-flash'];

        // ═══════════════════════════════════════════════════════
        // FEATURE GATING — Tools available per plan tier
        // ALL features are available to ALL tiers. Strategy is to 
        // give the best possible experience, and only limit by 
        // the number of allowed queries per month.
        // ═══════════════════════════════════════════════════════
        this.tierToolAccess = {
            starter: ['get_financial_summary', 'get_overdue_invoices', 'get_recent_transactions', 'get_customer_insights', 'get_customer_details'],
            free:    ['get_financial_summary', 'get_overdue_invoices', 'get_recent_transactions', 'get_customer_insights', 'get_customer_details'],
            solo:    ['get_financial_summary', 'get_overdue_invoices', 'get_recent_transactions', 'get_customer_insights', 'get_customer_details'],
            solo_pro: ['get_financial_summary', 'get_overdue_invoices', 'get_recent_transactions', 'get_customer_insights', 'get_customer_details'],
            enterprise: ['get_financial_summary', 'get_overdue_invoices', 'get_recent_transactions', 'get_customer_insights', 'get_customer_details'],
        };

        this.tierUpgradeMessages = {
            get_customer_insights: {
                requiredTier: 'Solo',
                message: 'Customer Analytics is a Solo plan feature. Upgrade to unlock top client rankings, portfolio health scores, and revenue attribution across your entire customer base.'
            },
            get_customer_details: {
                requiredTier: 'Solo',
                message: 'Customer Intelligence is a Solo plan feature. Upgrade to unlock churn risk prediction, health scoring, and next-purchase date forecasting for individual customers.'
            },
        };

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
        } else {
            this.genAI = new GoogleGenerativeAI(apiKey);
            console.log('📡 AI Service Activated — Tier-aware routing enabled');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CACHE SYSTEM
    // ═══════════════════════════════════════════════════════════

    /**
     * Normalize a query string into a stable cache key
     */
    _cacheKey(prefix, input) {
        const normalized = input.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 100);
        return `${prefix}:${normalized}`;
    }

    /**
     * Get from cache if not expired
     */
    _cacheGet(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        // LRU: move to end of Map iteration order on access
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.data;
    }

    /**
     * Set cache entry with TTL (LRU eviction when full)
     */
    _cacheSet(key, data, ttlMs) {
        // If key already exists, delete first to update insertion order
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        // Evict least-recently-used entries if at capacity
        while (this.cache.size >= this.CACHE_MAX_SIZE) {
            const lruKey = this.cache.keys().next().value;
            this.cache.delete(lruKey);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }

    // ═══════════════════════════════════════════════════════════
    // RATE LIMITER (Token Bucket)
    // ═══════════════════════════════════════════════════════════

    /**
     * Refill tokens based on elapsed time, then check if we have capacity
     */
    _canMakeRequest() {
        const now = Date.now();
        const elapsed = (now - this.rateBucket.lastRefill) / 60000; // minutes
        const refill = Math.floor(elapsed * this.rateBucket.refillRate);
        if (refill > 0) {
            this.rateBucket.tokens = Math.min(this.rateBucket.maxTokens, this.rateBucket.tokens + refill);
            this.rateBucket.lastRefill = now;
        }
        return this.rateBucket.tokens > 0;
    }

    /**
     * Consume one rate limit token
     */
    _consumeToken() {
        this.rateBucket.tokens = Math.max(0, this.rateBucket.tokens - 1);
    }

    // ═══════════════════════════════════════════════════════════
    // DAILY BUDGET SYSTEM
    // ═══════════════════════════════════════════════════════════

    /**
     * Get today's date string in Pacific time (Google resets RPD at midnight PT)
     */
    _getTodayPacific() {
        return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    }

    /**
     * Normalize tier key: handles both 'starter' and 'free' → canonical key
     */
    _normalizeTierKey(key) {
        if (!key || key === 'free') return 'starter';
        return key;
    }

    /**
     * Check if the organization has exhausted their monthly plan budget.
     * Limits are sourced from PLAN_TIERS (tierConfig.js) — single source of truth.
     */
    async _checkPlanBudget(orgId) {
        if (!orgId) return { allowed: true, limit: 999, used: 0 };

        // 1. Get Organization Plan
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('plan_tier')
            .eq('id', orgId)
            .single();
        
        if (orgError) {
            console.error('Plan Budget Error (Org Lookup):', orgError);
        }
        
        const rawTier = org?.plan_tier || 'starter';
        const tierKey = this._normalizeTierKey(rawTier);
        const planConfig = PLAN_TIERS[tierKey] || PLAN_TIERS.starter;
        const queryLimit = planConfig.ai.queriesPerMonth;
        const models = this.tierModels[tierKey] || this.models;

        // 2. Get Usage for current month
        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        firstOfMonth.setHours(0, 0, 0, 0);

        const { count, error } = await supabase
            .from('ai_requests')
            .select('id', { count: 'exact' })
            .eq('organization_id', orgId)
            .gte('createdAt', firstOfMonth.toISOString());

        if (error) {
            console.error('Plan Budget Error (Usage Query):', error);
            return { allowed: true, limit: queryLimit, used: 0 }; // Fail open
        }

        return {
            allowed: count < queryLimit,
            used: count,
            limit: queryLimit,
            tier: planConfig.name,
            models
        };
    }

    /**
     * Internal sleep helper for retries
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get remaining budget info (exposed to frontend via API)
     */
    async getBudgetStatus(userId, orgId) {
        const budget = await this._checkPlanBudget(orgId);
        
        return {
            userUsed: budget.used,
            userMax: budget.limit,
            userRemaining: Math.max(0, budget.limit - budget.used),
            tier: budget.tier,
            isExhausted: !budget.allowed,
        };
    }

    // ═══════════════════════════════════════════════════════════
    // CORE MODEL HELPERS & TOOL REGISTRY
    // ═══════════════════════════════════════════════════════════

    getToolDeclarations() {
        return [
            {
                functionDeclarations: [
                    {
                        name: "get_financial_summary",
                        description: "Fetch top-level metrics like total revenue, net profit, pending payments, safe-to-spend cash, tax reserves, and runway.",
                    },
                    {
                        name: "get_overdue_invoices",
                        description: "Fetch the aging report and a list of specific invoices that are currently overdue."
                    },
                    {
                        name: "get_recent_transactions",
                        description: "Fetch the most recent invoices, payments received, and expenses."
                    },
                    {
                        name: "get_customer_insights",
                        description: "Fetch high-level customer stats like top clients and general health across the portfolio."
                    },
                    {
                        name: "get_customer_details",
                        description: "Fetch deep intelligence for a specific customer including churn risk, health score, and next predicted purchase date. Requires customer_id.",
                        parameters: {
                            type: "object",
                            properties: {
                                customer_id: { type: "string", description: "The UUID of the customer" }
                            },
                            required: ["customer_id"]
                        }
                    }
                ]
            }
        ];
    }

    getModel(modelName, isJson = false) {
        if (!this.genAI) return null;
        
        const config = {
            model: modelName,
            generationConfig: isJson ? {
                maxOutputTokens: 800,
                responseMimeType: "application/json"
            } : {
                maxOutputTokens: 1500,
                temperature: 0.7,
            }
        };

        // Inject tools if not in JSON mode
        if (!isJson) {
            config.tools = this.getToolDeclarations();
        }

        return this.genAI.getGenerativeModel(config);
    }

    /**
     * Sanitise a Gemini history array:
     * - Filter out entries with empty text
     * - Drop leading 'model' turns (Gemini requires history to start with 'user')
     */
    _sanitiseHistory(history = []) {
        const filtered = history.filter(h => {
            const text = h?.parts?.[0]?.text || '';
            return text.trim().length > 0;
        });
        
        const valid = [];
        let expectedRole = 'user';
        for (const h of filtered) {
            if (h.role === expectedRole) {
                valid.push(h);
                expectedRole = expectedRole === 'user' ? 'model' : 'user';
            }
        }
        
        // Gemini requires history to end with 'model' if passing into startChat (so the next streamed prompt is 'user')
        if (valid.length > 0 && valid[valid.length - 1].role === 'user') {
            valid.pop();
        }
        
        return valid;
    }

    /**
     * Executes the local tool logic when Gemini yields a functionCall.
     * Returns a JSON-serialisable object to send back to the AI.
     */
    async executeTool(funcCall, context) {
        const name = funcCall.name;
        const orgId = context.organizationId;
        const tierKey = this._normalizeTierKey(context.planTier || 'starter');
        console.log(`🤖 Native Tool Call: ${name} (tier: ${tierKey})`);

        // ── Feature Gate: Check if this tool is available on the user's plan ──
        const allowedTools = this.tierToolAccess[tierKey] || this.tierToolAccess.starter;
        if (!allowedTools.includes(name)) {
            const upgradeInfo = this.tierUpgradeMessages[name] || {
                requiredTier: 'Solo',
                message: `This feature requires an upgraded plan.`
            };
            console.log(`🔒 Tool ${name} gated for tier: ${tierKey}`);
            return {
                gated: true,
                required_plan: upgradeInfo.requiredTier,
                message: upgradeInfo.message,
                upgrade_url: '/dashboard/pricing'
            };
        }

        try {
            switch (name) {
                case "get_financial_summary": {
                    const stats = await analyticsService.getDashboardStats(orgId).catch(() => ({}));
                    const safeToSpend = await analyticsService.getSafeToSpend(orgId).catch(() => ({}));
                    
                    // Pre-calculate derived business metrics to avoid AI hallucination
                    const totalRevenue = stats.total_revenue || 0;
                    const totalExpenses = stats.total_expenses || 0;
                    const netProfit = totalRevenue - totalExpenses;
                    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

                    return { 
                        stats: {
                            ...stats,
                            total_clients: stats.total_customers || 0, // Explicit mapping
                            net_profit: netProfit,
                            profit_margin: profitMargin.toFixed(2) + '%'
                        }, 
                        safeToSpend 
                    };
                }
                
                case "get_overdue_invoices": {
                    // Fetch directly instead of relying on context
                    const res = await supabase.from('invoices')
                        .select('*')
                        .eq('organization_id', orgId)
                        .eq('status', 'pending')
                        .lt('dueDate', new Date().toISOString())
                        .order('created_at', { ascending: false });
                    
                    const overdueInvoices = res.data || [];
                    const now = new Date();
                    const ageing = { current: 0, near: 0, critical: 0, totalOverdue: 0 };
                    
                    overdueInvoices.forEach(inv => {
                        const dueDate = inv.dueDate || inv.due_date; // Backwards compatibility if any
                        const diffDays = Math.ceil((now - new Date(dueDate)) / 86400000);
                        ageing.totalOverdue += inv.total;
                        if (diffDays <= 30) ageing.current += inv.total;
                        else if (diffDays <= 60) ageing.near += inv.total;
                        else ageing.critical += inv.total;
                    });
                    
                    return { ageing, riskyInvoices: overdueInvoices.slice(0, 5) };
                }

                case "get_recent_transactions": {
                    const invoices = await supabase.from('invoices').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(5);
                    const payments = await supabase.from('payments').select('*, customers(name)').eq('organization_id', orgId).order('date', { ascending: false }).limit(5);
                    const expenses = await supabase.from('expenses').select('*').eq('organization_id', orgId).order('date', { ascending: false }).limit(5);
                    return { 
                        invoices: invoices.data || [], 
                        payments: payments.data || [], 
                        expenses: expenses.data || [] 
                    };
                }

                case "get_customer_insights": {
                    const insights = await analyticsService.getCustomerInsights(orgId).catch(() => []);
                    return { customers: insights };
                }

                case "get_customer_details": {
                    const customerId = funcCall.args?.customer_id;
                    if (!customerId) return { error: "Customer ID is required." };
                    const intelligence = await analyticsService.getCustomerIntelligence(customerId, orgId).catch(() => ({}));
                    return { intelligence };
                }

                default:
                    return { error: `Tool ${name} not implemented.` };
            }
        } catch (error) {
            console.error(`Tool Execution Error (${name}):`, error);
            return { error: `Failed to execute tool ${name}` };
        }
    }

    isCircuitOpen() {
        if (!this.circuitStatus.open) return false;
        if (Date.now() > this.circuitStatus.until) {
            this.circuitStatus.open = false;
            return false;
        }
        return true;
    }

    openCircuit(error) {
        const cooldown = 60000; // 60 seconds (longer cooldown for free tier)
        this.circuitStatus = { open: true, until: Date.now() + cooldown };
    }

    async executeWithLock(key, fn) {
        if (this.pendingRequests.has(key)) {
            console.log(`📡 Sharing in-flight request for: ${key}`);
            return this.pendingRequests.get(key);
        }

        const promise = (async () => {
            try {
                return await fn();
            } finally {
                this.pendingRequests.delete(key);
            }
        })();

        this.pendingRequests.set(key, promise);
        return promise;
    }

    isRetryable(error) {
        if (!error) return false;
        const msg = error.message?.toLowerCase() || '';
        const status = error.status || error.statusCode || 0;
        
        const isTransient = (
            status === 429 || status === 503 ||
            msg.includes('429') || msg.includes('quota') ||
            msg.includes('overloaded') || msg.includes('rate limit')
        );

        const isConfigError = (
            status === 404 || msg.includes('not found') || msg.includes('not supported')
        );

        return isTransient || isConfigError;
    }

    // ═══════════════════════════════════════════════════════════
    // MAIN API: processQuery (Chat)
    // ═══════════════════════════════════════════════════════════

    async processQuery(query, context = {}, retry = true) {
        const userId = context.user?.id || 'anon';
        const actionAgents = ['agent_reminder', 'agent_settlement', 'agent_analytics', 'agent_cashflow'];
        
        if (context.agentId && actionAgents.includes(context.agentId)) {
            return this.processStructuredAgentQuery(query, context.agentId, context);
        }

        // 1. Check cache first (FREE — no API call)
        const cacheKey = this._cacheKey('chat', query);
        const cached = this._cacheGet(cacheKey);
        if (cached) {
            console.log(`📡 Cache HIT for chat query: "${query.slice(0, 30)}..."`);
            return { ...cached, provider: cached.provider + ':cached' };
        }

        // 2. Check budget + rate limits before calling API
        const orgId = context.organizationId;
        const budget = await this._checkPlanBudget(orgId);
        
        if (!this.genAI || this.isCircuitOpen() || !budget.allowed || !this._canMakeRequest()) {
            const reason = !this.genAI ? 'no_api_key' 
                : this.isCircuitOpen() ? 'circuit_open' 
                : !this._canMakeRequest() ? 'rpm_limit' 
                : 'monthly_budget_exhausted';
            console.log(`📡 Local fallback: ${reason} (user: ${userId})`);
            
            if (!budget.allowed) {
                throw new Error(`You have reached your monthly limit of ${budget.limit} AI queries on the ${budget.tier} plan. Please upgrade to continue.`);
            }
            
            throw new Error(`Cloud Busy: AI engine is currently in cooldown. Please try again in 60s.`);
        }

        const lockKey = `chat_${userId}_${query.slice(0, 20)}`;
        const targetModels = budget.models || this.models;

        return this.executeWithLock(lockKey, async () => {
            let lastError = null;
            
            for (const modelName of targetModels) {
                try {
                    this._consumeToken();
                    const modelInstance = this.getModel(modelName);
                    if (!modelInstance) continue;

                    const prompt = this.buildChatbotPrompt(query, context);
                    const rawHistory = context.history || [];
                    // Gemini requires history[0].role === 'user' and no empty parts
                    const history = this._sanitiseHistory(rawHistory);
                    
                    // Use startChat for multi-turn memory
                    const chat = modelInstance.startChat({ history });
                    let result = await chat.sendMessage(prompt);
                    let response = await result.response;
                    
                    // Handle potential function calls in non-streaming mode
                    let iterations = 0;
                    let pendingCalls = (typeof response.functionCalls === 'function' ? response.functionCalls() : null) || [];
                    while (pendingCalls.length > 0 && iterations < 5) {
                        const funcCall = pendingCalls[0];
                        const toolResult = await this.executeTool(funcCall, context);
                        
                        result = await chat.sendMessage([{
                            functionResponse: {
                                name: funcCall.name,
                                response: toolResult
                            }
                        }]);
                        response = await result.response;
                        pendingCalls = (typeof response.functionCalls === 'function' ? response.functionCalls() : null) || [];
                        iterations++;
                    }

                    const text = response.text();
                    const action = this.extractAction(text, query);

                    const budgetStatus = await this.getBudgetStatus(userId, orgId);
                    const responseData = {
                        text: text.trim(),
                        action,
                        data: action ? action.data : null,
                        usage: response.usageMetadata,
                        provider: `cloud:${modelName}`,
                        budget: budgetStatus,
                    };

                    // Cache the response
                    this._cacheSet(cacheKey, responseData, this.CACHE_TTL.chat);

                    return responseData;
                } catch (error) {
                    lastError = error;
                    if (this.isRetryable(error)) {
                        const status = error.status || error.statusCode || 'N/A';
                        console.warn(`📡 [${modelName}] Skip: ${status}`);
                        continue;
                    } else {
                        console.error(`📡 [${modelName}] Fatal AI Error:`, error.message);
                        break; 
                    }
                }
            }

            const isRetryable = this.isRetryable(lastError);
            if (isRetryable && (lastError?.status === 429 || lastError?.statusCode === 429)) {
                this.openCircuit(lastError);
            }

            throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
        });
    }

    /**
     * Process queries with streaming support (ChatGPT style)
     * Yields chunks of tokens to the client via a callback or generator
     */
    async *processQueryStream(query, context = {}) {
        const userId = context.user?.id || 'anon';
        const orgId = context.organizationId;
        
        const budget = await this._checkPlanBudget(orgId);
        if (!budget.allowed) {
            throw new Error(`You have reached your monthly limit of ${budget.limit} AI queries on the ${budget.tier} plan. Please upgrade to continue.`);
        }
        
        if (!this.genAI || this.isCircuitOpen() || !this._canMakeRequest()) {
            throw new Error(`Cloud Busy: AI engine is currently in cooldown. Please try again in 60s.`);
        }

        const targetModels = budget.models || this.models;
        let fullText = '';
        let lastError = null;

        for (const modelUsed of targetModels) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelUsed);
                if (!modelInstance) continue;

                const prompt = this.buildChatbotPrompt(query, context);
                const rawHistory = context.history || [];
                // Gemini requires history[0].role === 'user' and no empty parts
                const history = this._sanitiseHistory(rawHistory);
                
                const chat = modelInstance.startChat({ history });
                let currentResult = await chat.sendMessageStream(prompt);
                
                let done = false;
                let finalResponse = null;

                while (!done) {
                    let functionCallOccurred = false;
                    for await (const chunk of currentResult.stream) {
                        let funcCall = null;
                        try {
                            if (chunk.candidates?.length > 0) {
                                const calls = typeof chunk.functionCalls === 'function' ? chunk.functionCalls() : [];
                                funcCall = calls?.[0] || null;
                            }
                        } catch (e) {
                            // ignore empty or malformed candidates
                        }
                        
                        if (funcCall) {
                            functionCallOccurred = true;
                            // Execute native tool
                            const toolResult = await this.executeTool(funcCall, context);
                            
                            // Yield Generative UI Event to the Frontend stream immediately
                            yield {
                                type: 'gen_ui',
                                component: funcCall.name,
                                data: toolResult
                            };
                            
                            // CRITICAL: Await the current stream's completion so Gemini SDK registers the model's functionCall turn internally.
                            try {
                                await currentResult.response;
                            } catch (ignoreErr) { }
                            
                            // Feed result back into Gemini to get the final text response
                            currentResult = await chat.sendMessageStream([{
                                functionResponse: {
                                    name: funcCall.name,
                                    response: toolResult
                                }
                            }]);
                            break; // Break inner loop, restart stream with new result
                        } else if (chunk.text) {
                            // Some chunks might just be empty parts, so check if text() is valid
                            try {
                                const chunkText = chunk.text();
                                if (chunkText) {
                                    fullText += chunkText;
                                    yield { type: 'token', text: chunkText };
                                }
                            } catch (e) {
                                // Ignore empty text chunks
                            }
                        }
                    }
                    
                    if (!functionCallOccurred) {
                        done = true;
                        // Wait for the final usage metadata
                        finalResponse = await currentResult.response;
                    }
                }

                const action = this.extractAction(fullText, query);
                const budgetStatus = await this.getBudgetStatus(userId, orgId);
                
                // Cache the full response for subsequent non-stream calls
                const cacheKey = this._cacheKey('chat', query);
                this._cacheSet(cacheKey, {
                    text: fullText.trim(),
                    action,
                    data: action ? action.data : null,
                    usage: finalResponse?.usageMetadata,
                    provider: `cloud:${modelUsed}`,
                    budget: budgetStatus,
                }, this.CACHE_TTL.chat);

                yield { 
                    type: 'complete', 
                    text: fullText.trim(),
                    action,
                    usage: finalResponse?.usageMetadata,
                    provider: `cloud:${modelUsed}`,
                    budget: budgetStatus
                };

                return; // Stream succeeded, exit the generator successfully

            } catch (error) {
                lastError = error;
                if (this.isRetryable(error)) {
                    console.warn(`📡 [${modelUsed}] Stream Error (${error.status || 'N/A'}). Retrying with fallback...`);
                    // reset accumulated text for the next model
                    fullText = '';
                    continue;
                } else {
                    console.error(`📡 [${modelUsed}] Fatal Stream Error:`, error.stack || error.message);
                    break;
                }
            }
        }

        const isRetryable = this.isRetryable(lastError);
        if (isRetryable && (lastError?.status === 429 || lastError?.statusCode === 429)) {
            this.openCircuit(lastError);
        }

        if (lastError) {
            const msg = lastError.message || '';
            if (lastError.status === 503 || msg.includes('503')) {
                throw new Error('Our AI models are experiencing unusually high demand. Please try again in a few moments.');
            } else if (lastError.status === 429 || msg.includes('429') || msg.includes('quota')) {
                throw new Error('You have exhausted your AI budget or rate limit. Please wait a minute before trying again.');
            } else {
                throw new Error('AI processing failed securely. Please modify your query and try again.');
            }
        }

        throw new Error('Cloud Busy: All AI backup models failed.');
    }

    /**
     * Process queries strictly enforcing structured JSON output
     */
    async processStructuredAgentQuery(query, agentId, contextData) {
        const userId = contextData.user?.id || 'anon';

        const orgId = contextData.organizationId;
        const budget = await this._checkPlanBudget(orgId);

        if (!this.genAI || !budget.allowed || this.isCircuitOpen() || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI Agent is temporarily unavailable or over budget.');
        }

        const { invoices = [], stats = {}, currency } = contextData;
        let systemPrompt = "";

        switch (agentId) {
            case 'agent_reminder':
                systemPrompt = `You are a strict, efficient Auto-Reminder Agent. Overdue: ${formatCurrency(stats.pendingPayments, currency)}. QUERY: "${query}"`;
                break;
            case 'agent_settlement':
                systemPrompt = `You are a strict Settlement Agent. Overdue Invoices: ${JSON.stringify(invoices.filter(i => i.status === 'pending' && new Date(i.dueDate) < new Date()).slice(0, 3))}. QUERY: "${query}"`;
                break;
            default:
                systemPrompt = `You are a financial AI agent. QUERY: "${query}"`;
                break;
        }

        let lastError = null;
        const targetModels = budget.models || this.models;
        for (let i = 0; i < targetModels.length; i++) {
            const modelName = targetModels[i];
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                if (!modelInstance) continue;

                const result = await modelInstance.generateContent(systemPrompt);
                const response = await result.response;
                
                const budgetStatus = await this.getBudgetStatus(userId, orgId);
                
                return {
                    text: response.text().trim(),
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:json`,
                    budget: budgetStatus,
                };
            } catch (error) {
                lastError = error;
                // If there's another model to try, wait briefly to avoid rapid-fire 429s
                if (i < targetModels.length - 1 && this.isRetryable(error)) {
                    console.log(`📡 [${modelName}] Retryable error, cooling down for 1s...`);
                    await this._sleep(1200);
                    continue;
                }
                break;
            }
        }

        // If all models fail, throw a Cloud Busy error instead of falling back to local mode
        throw new Error(`Cloud Busy: All AI models (${targetModels.join(', ')}) are currently rate-limited or unavailable. Please try again in a few seconds.`);
    }

    buildChatbotPrompt(query, context) {
        const { 
            businessType,
            settings = {},
            temporal = {}
        } = context;

        // Derive everything from real settings — no hardcoded defaults
        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const businessSegment = businessType || settings?.business_type || settings?.businessType || 'freelancer';
        const ownerName = settings?.owner_name || settings?.full_name || null;

        // Safe Date Helper
        const safeDateFormat = (dateStr) => {
            if (!dateStr) return 'N/A';
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        };
        
        let contextBlock = `## SYSTEM CONTEXT\n`;
        contextBlock += `- **Current Time**: ${safeDateFormat(temporal.currentTime)} (${temporal.currentDay})\n`;
        contextBlock += `- **Fiscal Year**: ${temporal.fiscalYear}\n`;
        contextBlock += `- **Business**: ${businessName} (${businessSegment})\n`;
        if (ownerName) contextBlock += `- **Owner**: ${ownerName}\n`;
        contextBlock += `- **Currency**: ${currency}\n\n`;

        contextBlock += `---\n`;
        contextBlock += `## INSTRUCTIONS FOR NATIVE TOOL CALLING\n\n`;
        contextBlock += `You do not have all the user's financial data by default. To answer questions about revenue, overdue invoices, cash flow, or recent transactions, you MUST use the provided tools.\n`;
        contextBlock += `If the user asks "Who owes me?", run the get_overdue_invoices tool first.\n`;
        contextBlock += `Always execute tools if needed before responding.\n\n`;
        contextBlock += `**CRITICAL ANTI-HALLUCINATION RULE:**\n`;
        contextBlock += `- You have ZERO financial data in your training. ALL numbers MUST come from tool results.\n`;
        contextBlock += `- If a tool call fails or you cannot call tools, say: "I'm unable to fetch your data right now. Please try again."\n`;
        contextBlock += `- NEVER fabricate amounts, counts, percentages, or dates. Every number you output must come from a tool response.\n\n`;

        contextBlock += `---\n`;
        contextBlock += `## RESPONSE FORMATTING RULES (YOU MUST FOLLOW)\n\n`;
        contextBlock += `You are **Capita**, a high-end Strategic CFO AI for freelancers. Give sharp, structured, visually clear answers.\n\n`;
        contextBlock += `**TONE:** Authoritative but warm. Senior advisor, not a chatbot.\n\n`;
        contextBlock += `**FORMAT RULES:**\n`;
        contextBlock += `- Start with a **1-sentence executive summary** — bold the key number or insight.\n`;
        contextBlock += `- Use \`## Heading\` for responses covering more than 2 topics.\n`;
        contextBlock += `- Use **bullet points** for any list of 3+ items. Never write lists as a comma sentence.\n`;
        contextBlock += `- **Bold** every currency amount, percentage, and key metric.\n`;
        contextBlock += `- **DEFINITION: PROFIT** - In this system, "Profit" is specifically "Total Revenue (Paid Invoices) minus Total Expenses".\n`;
        contextBlock += `- **DEFINITION: OVERDUE** - An invoice is "Overdue" ONLY if its status is 'pending' AND its dueDate is in the past.\n`;
        contextBlock += `- Use \`> ⚠️ ...\` for risks. Use \`> 🚀 ...\` for growth opportunities.\n`;
        contextBlock += `- End with **→ one clear next action** the user should take.\n\n`;
        contextBlock += `**NEVER DO:**\n`;
        contextBlock += `- ❌ Walls of text — max 4 sentences per paragraph.\n`;
        contextBlock += `- ❌ Comma-separated lists when there are 3+ items.\n`;
        contextBlock += `- ❌ Markdown Tables — NEVER use markdown tables (\`| ... |\`) as they are visually broken in this interface. Use tools instead.\n`;
        contextBlock += `- ❌ Filler phrases like "I can help with that" or "Great question!"\n`;
        contextBlock += `- ❌ Repeat the user's question back to them.\n\n`;
        
        contextBlock += `**CRITICAL — HIGH-FIDELITY TOOLS:**\n`;
        contextBlock += `- **ALWAYS** use the \`get_financial_summary\` tool if the user asks for a summary of their business.\n`;
        contextBlock += `- **COUNTING CLIENTS**: If asked for client count, use the \`total_clients\` field from the financial summary tool. NEVER sum invoice counts to estimate clients.\n`;
        contextBlock += `- **ISOLATION**: You are strictly locked to data for **${businessName}**. Reassure the user you only see their data.\n`;
        contextBlock += `- If the user asks about a SPECIFIC customer, use \`get_customer_insights\` to find their ID first, then use \`get_customer_details\` to get their risk/health metrics.\n`;
        contextBlock += `- If a tool is unavailable, use clean bullet points, NOT tables.\n`;
        contextBlock += `- **UPGRADE NUDGES**: If a tool returns a \`gated: true\` response, it means the feature requires a plan upgrade. Communicate the upgrade message naturally and warmly. Include the upgrade URL (/dashboard/pricing) as a suggestion. Do NOT try to answer with fabricated data — only relay the upgrade message.\n\n`;
        contextBlock += `**User's Question:** "${query}"`;

        return contextBlock;
    }

    extractAction(text, query) {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.includes('create') && lowerQuery.includes('invoice')) return { type: 'open_invoice_modal', data: {} };
        if (lowerQuery.includes('show') && lowerQuery.includes('invoice')) return { type: 'navigate', data: { to: '/invoices' } };
        
        if ((lowerQuery.includes('add') || lowerQuery.includes('create') || lowerQuery.includes('new')) && 
            (lowerQuery.includes('customer') || lowerQuery.includes('client'))) {
            return { type: 'open_customer_modal', data: {} };
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════
    // INVOICE PARSE (Magic Fill) — with cache
    // ═══════════════════════════════════════════════════════════

    async parseInvoiceText(text, userId = 'anon') {
        return this.executeWithLock(`parse_${userId}_${text.slice(0, 20)}`, async () => {
            // Cache check
            const cacheKey = this._cacheKey('invoice', text);
            const cached = this._cacheGet(cacheKey);
            if (cached) {
                console.log(`📡 Cache HIT for invoice parse`);
                return { ...cached, provider: cached.provider + ':cached' };
            }

            if (!this.genAI || !this._canMakeRequest()) {
                throw new Error('Cloud Busy: Unable to parse invoice using cloud models.');
            }

            for (const modelName of this.models) {
                try {
                    this._consumeToken();
                    const modelInstance = this.getModel(modelName, true);
                    const prompt = `Parse this text into a strict JSON invoice: "${text}"`;
                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                    const parsed = JSON.parse(jsonText);
                    
                    const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:magic` };
                    this._cacheSet(cacheKey, responseData, this.CACHE_TTL.invoice);
                    
                    return responseData;
                } catch (error) {
                    if (this.isRetryable(error)) continue;
                    break;
                }
            }
            throw new Error('Cloud Busy: Unable to parse invoice using cloud models.');
        });
    }

    /**
     * Audit a generated invoice for risks and suggests improvements
     */
    async auditInvoice(invoiceData, userId = 'anon') {
        const cacheKey = this._cacheKey('audit', JSON.stringify(invoiceData));
        const cached = this._cacheGet(cacheKey);
        if (cached) return { ...cached, provider: cached.provider + ':cached' };

        if (!this.genAI || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI Audit is currently unavailable.');
        }

        const prompt = `You are a strict financial auditor. Audit this invoice for errors (GST/Tax errors, pricing logic, missing information, risk of rejection).
        Invoice: ${JSON.stringify(invoiceData)}
        Return a strict JSON object: { "riskScore": number (0-100), "suggestions": string[] }`;

        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const parsed = JSON.parse(jsonText);
                
                const data = {
                    riskScore: parsed.riskScore ?? 0,
                    suggestions: parsed.suggestions ?? ["Looks perfect!"],
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:audit`,
                };
                this._cacheSet(cacheKey, data, this.CACHE_TTL.invoice);
                return data;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        throw new Error('Cloud Busy: AI Audit failed.');
    }

    // ═══════════════════════════════════════════════════════════
    // INSIGHTS — 100% Rule-Based (ZERO API calls)
    // ═══════════════════════════════════════════════════════════

    async generateInsights(context) {
        const insights = [];
        const { stats = {}, settings = {}, currency: ctxCurrency } = context;
        const currency = ctxCurrency || settings?.currency || 'INR';
        if (stats.pending_payments > 0) {
            insights.push({ 
                id: 'rule-pend', 
                title: 'Receivables', 
                value: formatCurrency(stats.pending_payments, currency), 
                description: 'You have outstanding invoices to collect.', 
                type: 'warning' 
            });
        }
        return { 
            data: insights, 
            provider: 'local_rulebased',
            timestamp: new Date().toISOString()
        };
    }

    predictRevenue(historicalData) {
        return [{ month: 'Forecast', revenue: 0, isForecast: true, provider: 'cloud_forecast' }];
    }

    // ═══════════════════════════════════════════════════════════
    // COLLECTION DRAFTS — with cache
    // ═══════════════════════════════════════════════════════════

    async generateCollectionDraft(invoice, currency, forceAggressive = false, userId = 'anon') {
        const cacheKey = this._cacheKey('draft', `${invoice.invoiceNumber}_${forceAggressive}`);
        const cached = this._cacheGet(cacheKey);
        if (cached) {
            return { ...cached, provider: cached.provider + ':cached' };
        }

        if (!this.genAI || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: Unable to generate collection draft using cloud models.');
        }

        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate collection draft for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:draft` };
                this._cacheSet(cacheKey, responseData, this.CACHE_TTL.draft);
                
                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        // Throw error instead of local draft
        throw new Error('Cloud Busy: Unable to generate collection draft using cloud models.');
    }

    async generateSettlementOffer(invoice, currency, userId = 'anon') {
        const cacheKey = this._cacheKey('draft', `settle_${invoice.invoiceNumber}`);
        const cached = this._cacheGet(cacheKey);
        if (cached) {
            return { ...cached, provider: cached.provider + ':cached' };
        }

        if (!this.genAI || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: Unable to generate settlement offer using cloud models.');
        }
        
        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate settlement for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:settle` };
                this._cacheSet(cacheKey, responseData, this.CACHE_TTL.draft);
                
                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        // Throw error instead of local settlement
        throw new Error('Cloud Busy: Unable to generate settlement offer using cloud models.');
    }

    async parseCommand(text, userId = 'anon') {
        if (!this.genAI || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI Command Parser is temporarily unavailable.');
        }
        
        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Parse command: "${text}"`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:cmd` };
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        throw new Error('Cloud Busy: Unable to parse command using cloud models.');
    }

    /* ========== HELPER METHODS ========== */
}

export default new AIService();
