import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { formatCurrency, getCurrencySymbol } from '../../core/utils/formatting.js';

dotenv.config();

/**
 * AI Service using Google Gemini API
 * Optimized for Free Tier: 20 users on 40 RPD budget
 * 
 * Strategy:
 * 1. Only use models with free-tier quota (2.5-flash, 3-flash)
 * 2. TTL-based response cache (3-5x RPD multiplier)
 * 3. Per-user daily AI budget (fair share)
 * 4. Proactive rate limiter (token bucket, prevents 429s)
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
        // RESPONSE CACHE — TTL-based, in-memory
        // ═══════════════════════════════════════════════════════
        this.cache = new Map(); // key → { data, expiresAt }
        this.CACHE_TTL = {
            chat: 5 * 60 * 1000,       // 5 minutes for chat
            insights: 30 * 60 * 1000,   // 30 minutes for insights
            invoice: 10 * 60 * 1000,    // 10 minutes for invoice parse
            draft: 15 * 60 * 1000,      // 15 minutes for collection drafts
        };

        // ═══════════════════════════════════════════════════════
        // RATE LIMITER — Token Bucket (5 RPM per model = 10 total)
        // ═══════════════════════════════════════════════════════
        this.rateBucket = {
            tokens: 10,           // Start full (5 per model × 2 models)
            maxTokens: 10,
            refillRate: 10,       // 10 tokens per minute
            lastRefill: Date.now(),
        };

        // ═══════════════════════════════════════════════════════
        // DAILY BUDGET — 35 RPD (saving 5 as buffer from 40 total)
        // ═══════════════════════════════════════════════════════
        this.dailyBudget = {
            maxRequests: 35,
            used: 0,
            resetDate: this._getTodayPacific(),
            perUser: new Map(),   // userId → count
        };

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
        } else {
            this.genAI = new GoogleGenerativeAI(apiKey);
            // Only models with FREE TIER quota (verified from AI Studio dashboard)
            this.models = [
                'gemini-2.5-flash',       // 5 RPM, 250K TPM, 20 RPD ✅
                'gemini-3-flash-preview',  // 5 RPM, 250K TPM, 20 RPD ✅
            ];
            console.log('📡 AI Service Initialized — Free Tier Optimized (2 models, 40 RPD budget)');
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
        return entry.data;
    }

    /**
     * Set cache entry with TTL
     */
    _cacheSet(key, data, ttlMs) {
        // Prevent cache from growing unbounded (max 200 entries)
        if (this.cache.size > 200) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
        this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    }

    // ═══════════════════════════════════════════════════════════
    // RATE LIMITER (Token Bucket)
    // ═══════════════════════════════════════════════════════════

    /**
     * Check if we can make a request without hitting RPM limits
     */
    _canMakeRequest() {
        // Refill tokens based on elapsed time
        const now = Date.now();
        const elapsed = now - this.rateBucket.lastRefill;
        const tokensToAdd = (elapsed / 60000) * this.rateBucket.refillRate;
        this.rateBucket.tokens = Math.min(
            this.rateBucket.maxTokens,
            this.rateBucket.tokens + tokensToAdd
        );
        this.rateBucket.lastRefill = now;

        return this.rateBucket.tokens >= 1;
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
     * Check if the daily budget has been exceeded
     */
    _isDailyBudgetExhausted(userId) {
        // Reset if it's a new day
        const today = this._getTodayPacific();
        if (this.dailyBudget.resetDate !== today) {
            this.dailyBudget.used = 0;
            this.dailyBudget.perUser.clear();
            this.dailyBudget.resetDate = today;
            console.log('📡 Daily AI budget reset (midnight Pacific).');
        }

        // Global budget check
        if (this.dailyBudget.used >= this.dailyBudget.maxRequests) {
            return true;
        }

        // Per-user fair share: max 5 per user per day (35 ÷ ~7-20 users)
        const userUsed = this.dailyBudget.perUser.get(userId) || 0;
        if (userUsed >= 5) {
            return true;
        }

        return false;
    }

    /**
     * Record a successful API call against the budget
     */
    _recordUsage(userId) {
        this.dailyBudget.used++;
        const userUsed = this.dailyBudget.perUser.get(userId) || 0;
        this.dailyBudget.perUser.set(userId, userUsed + 1);
    }

    /**
     * Get remaining budget info (exposed to frontend via API)
     */
    getBudgetStatus(userId) {
        const today = this._getTodayPacific();
        if (this.dailyBudget.resetDate !== today) {
            this.dailyBudget.used = 0;
            this.dailyBudget.perUser.clear();
            this.dailyBudget.resetDate = today;
        }

        const userUsed = this.dailyBudget.perUser.get(userId) || 0;
        const globalRemaining = Math.max(0, this.dailyBudget.maxRequests - this.dailyBudget.used);
        const userRemaining = Math.max(0, 5 - userUsed);

        return {
            globalUsed: this.dailyBudget.used,
            globalRemaining,
            globalMax: this.dailyBudget.maxRequests,
            userUsed,
            userRemaining,
            userMax: 5,
            isExhausted: globalRemaining === 0 || userRemaining === 0,
        };
    }

    // ═══════════════════════════════════════════════════════════
    // CORE MODEL HELPERS
    // ═══════════════════════════════════════════════════════════

    getModel(modelName, isJson = false) {
        if (!this.genAI) return null;
        return this.genAI.getGenerativeModel({
            model: modelName,
            generationConfig: isJson ? {
                maxOutputTokens: 800,
                responseMimeType: "application/json"
            } : {
                maxOutputTokens: 1500,  // Reduced from 2048 to save tokens
                temperature: 0.7,
            }
        });
    }

    isCircuitOpen() {
        if (this.circuitStatus.open && Date.now() < this.circuitStatus.until) {
            return true;
        }
        if (this.circuitStatus.open) {
            console.log('📡 Gemini Circuit Closed: Re-enabling cloud brain.');
            this.circuitStatus.open = false;
        }
        return false;
    }

    openCircuit(error) {
        const cooldown = 60000; // 60 seconds (longer cooldown for free tier)
        this.circuitStatus = { open: true, until: Date.now() + cooldown };
        console.warn(`📡 Gemini Circuit Opened: Defaulting to Local Mode for ${cooldown/1000}s.`);
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
        if (!this.genAI || this.isCircuitOpen() || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            const reason = !this.genAI ? 'no_api_key' 
                : this.isCircuitOpen() ? 'circuit_open' 
                : !this._canMakeRequest() ? 'rpm_limit' 
                : 'daily_budget';
            console.log(`📡 Local fallback: ${reason} (user: ${userId})`);
            
            const fallback = await this.fallbackProcessQuery(query, context);
            return {
                ...fallback,
                provider: 'local_fallback',
                budget: this.getBudgetStatus(userId),
                is_cooldown: reason !== 'no_api_key'
            };
        }

        const lockKey = `chat_${userId}_${query.slice(0, 20)}`;

        return this.executeWithLock(lockKey, async () => {
            let lastError = null;
            
            for (const modelName of this.models) {
                try {
                    this._consumeToken();
                    const modelInstance = this.getModel(modelName);
                    if (!modelInstance) continue;

                    const prompt = this.buildChatbotPrompt(query, context);
                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();
                    const action = this.extractAction(text, query);

                    const responseData = {
                        text: text.trim(),
                        action,
                        data: action ? action.data : null,
                        usage: response.usageMetadata,
                        provider: `cloud:${modelName}`,
                        budget: this.getBudgetStatus(userId),
                    };

                    // Record usage & cache
                    this._recordUsage(userId);
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

            const fallback = await this.fallbackProcessQuery(query, context);
            return {
                ...fallback,
                provider: isRetryable ? 'local_fallback' : 'error_fallback',
                budget: this.getBudgetStatus(userId),
                error: lastError?.message || 'AI service unavailable'
            };
        });
    }

    /**
     * Process queries strictly enforcing structured JSON output
     */
    async processStructuredAgentQuery(query, agentId, contextData) {
        const userId = contextData.user?.id || 'anon';

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            const fallback = await this.fallbackProcessQuery(query, contextData);
            return { ...fallback, provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
        }

        const { invoices = [], stats = {}, currency } = contextData;
        let systemPrompt = "";

        switch (agentId) {
            case 'agent_reminder':
                systemPrompt = `You are a strict, efficient Auto-Reminder Agent. Overdue: ${formatCurrency(stats.pendingPayments, currency)}. QUERY: "${query}"`;
                break;
            case 'agent_settlement':
                systemPrompt = `You are a strict Settlement Agent. Overdue Invoices: ${JSON.stringify(invoices.filter(i => i.status === 'overdue').slice(0, 3))}. QUERY: "${query}"`;
                break;
            default:
                systemPrompt = `You are a financial AI agent. QUERY: "${query}"`;
                break;
        }

        let lastError = null;
        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                if (!modelInstance) continue;

                const result = await modelInstance.generateContent(systemPrompt);
                const response = await result.response;
                
                this._recordUsage(userId);
                
                return {
                    text: response.text().trim(),
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:json`,
                    budget: this.getBudgetStatus(userId),
                };
            } catch (error) {
                lastError = error;
                if (this.isRetryable(error)) continue;
                break;
            }
        }

        return { ...(await this.fallbackProcessQuery(query, contextData)), provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
    }

    buildChatbotPrompt(query, context) {
        const { stats = {}, currency = 'INR', safeToSpend, businessType = 'solopreneur' } = context;
        
        return `You are Capita AI CFO, a premium financial advisor for a ${businessType}.
        
        CONTEXT:
        - Revenue: ${formatCurrency(stats.total_revenue || 0, currency)}
        - Pending Receipts: ${formatCurrency(stats.pending_payments || 0, currency)}
        - Safe-to-Spend: ${safeToSpend?.safeToSpend || 'N/A'}
        
        INSTRUCTIONS:
        1. Only mention the numbers above if they are relevant to the user's query.
        2. If the user asks a social or non-business question, respond politely as a CFO but do NOT include financial data.
        3. Be concise and professional. Use a helpful, advisor-like tone.
        4. Keep responses SHORT — max 3-4 sentences. Users are on mobile.
        
        User Query: "${query}"`;
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
        // Cache check
        const cacheKey = this._cacheKey('invoice', text);
        const cached = this._cacheGet(cacheKey);
        if (cached) {
            console.log(`📡 Cache HIT for invoice parse`);
            return { ...cached, provider: cached.provider + ':cached' };
        }

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            return { ...this.fallbackParseInvoice(text), provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
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
                
                this._recordUsage(userId);
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:magic`, budget: this.getBudgetStatus(userId) };
                this._cacheSet(cacheKey, responseData, this.CACHE_TTL.invoice);
                
                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { ...this.fallbackParseInvoice(text), provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
    }

    // ═══════════════════════════════════════════════════════════
    // INSIGHTS — 100% Rule-Based (ZERO API calls)
    // ═══════════════════════════════════════════════════════════

    async generateInsights(context) {
        // STRATEGY: Always use rule-based. This saves 5-15 RPD/day.
        // The math-based insights are just as useful and instant.
        return { 
            data: this.fallbackGenerateInsights(context), 
            provider: 'local_rulebased',
            timestamp: new Date().toISOString()
        };
    }

    predictRevenue(historicalData) {
        return [{ month: 'Forecast', revenue: 0, isForecast: true, provider: 'local_fallback' }];
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

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
        }

        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate collection draft for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                this._recordUsage(userId);
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:draft`, budget: this.getBudgetStatus(userId) };
                this._cacheSet(cacheKey, responseData, this.CACHE_TTL.draft);
                
                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
    }

    async generateSettlementOffer(invoice, currency, userId = 'anon') {
        const cacheKey = this._cacheKey('draft', `settle_${invoice.invoiceNumber}`);
        const cached = this._cacheGet(cacheKey);
        if (cached) {
            return { ...cached, provider: cached.provider + ':cached' };
        }

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
        }
        
        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate settlement for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                this._recordUsage(userId);
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:settle`, budget: this.getBudgetStatus(userId) };
                this._cacheSet(cacheKey, responseData, this.CACHE_TTL.draft);
                
                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
    }

    async parseCommand(text, userId = 'anon') {
        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            return { type: 'LIST_OVERDUE', provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
        }
        
        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Parse command: "${text}"`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                this._recordUsage(userId);
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:cmd`, budget: this.getBudgetStatus(userId) };
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { type: 'LIST_OVERDUE', provider: 'local_fallback', budget: this.getBudgetStatus(userId) };
    }

    /* ========== Fallback Methods (Always Available) ========== */

    fallbackProcessQuery(query, context) {
        const { stats = {}, safeToSpend = {}, currency = 'INR' } = context;
        let msg = `👋 **Capita Local Mode**\n\nI'm currently operating locally due to cloud busy state.\n`;
        msg += `• **Revenue**: ${formatCurrency(stats.total_revenue || 0, currency)}\n`;
        msg += `• **Safe-to-Spend**: ${formatCurrency(safeToSpend?.safeToSpend || 0, currency)}\n`;
        return { text: msg, provider: 'local_fallback', timestamp: new Date().toISOString() };
    }

    fallbackParseInvoice(text) {
        return { buyer: { name: "", phone: "" }, items: [], provider: 'local_fallback' };
    }

    fallbackGenerateInsights(context) {
        const { stats = {}, health = {}, safeToSpend = {}, currency = 'INR' } = context;
        const insights = [];
        insights.push({ id: 'fb-rev', title: 'Revenue Snapshot', value: formatCurrency(stats.total_revenue || 0, currency), description: 'Local tracking active.', type: 'info' });
        if (stats.pending_payments > 0) {
            insights.push({ id: 'fb-pend', title: 'Receivables', value: formatCurrency(stats.pending_payments, currency), description: 'Track your pending collections.', type: 'warning' });
        }
        return insights;
    }

    fallbackCollectionDraft(invoice, currency, forceAggressive = false) {
        return { subject: 'Reminder', body: 'Please pay invoice.', provider: 'local_fallback' };
    }
}

export default new AIService();
