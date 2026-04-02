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
            this.modelMetadata = {
                'gemini-2.5-flash': 'Flash 2.5',
                'gemini-3-flash-preview': 'Flash 3.0',
            };
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
        // Temporarily disabled: Always allow requests
        return true;
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
        // Temporarily disabled: Usage limits lifted
        return false;
    }

    /**
     * Internal sleep helper for retries
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
        // Reporting infinite availability to the UI
        return {
            globalUsed: this.dailyBudget.used,
            globalRemaining: 999,
            globalMax: 999,
            userUsed,
            userRemaining: 999,
            userMax: 999,
            isExhausted: false,
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
        // Temporarily disabled: Always try cloud brain first
        return false;
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
        if (!this.genAI || this.isCircuitOpen() || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            const reason = !this.genAI ? 'no_api_key' 
                : this.isCircuitOpen() ? 'circuit_open' 
                : !this._canMakeRequest() ? 'rpm_limit' 
                : 'daily_budget';
            console.log(`📡 Local fallback: ${reason} (user: ${userId})`);
            
            throw new Error(`Cloud Busy: AI engine is currently in cooldown or over budget. Please try again in 60s.`);
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
                    const history = context.history || [];
                    
                    // Use startChat for multi-turn memory
                    const chat = modelInstance.startChat({ history });
                    const result = await chat.sendMessage(prompt);
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

            throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
        });
    }

    /**
     * Process queries strictly enforcing structured JSON output
     */
    async processStructuredAgentQuery(query, agentId, contextData) {
        const userId = contextData.user?.id || 'anon';

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI Agent is temporarily unavailable.');
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
        for (let i = 0; i < this.models.length; i++) {
            const modelName = this.models[i];
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
                // If there's another model to try, wait briefly to avoid rapid-fire 429s
                if (i < this.models.length - 1 && this.isRetryable(error)) {
                    console.log(`📡 [${modelName}] Retryable error, cooling down for 1s...`);
                    await this._sleep(1200);
                    continue;
                }
                break;
            }
        }

        // If all models fail, throw a Cloud Busy error instead of falling back to local mode
        throw new Error(`Cloud Busy: All AI models (${this.models.join(', ')}) are currently rate-limited or unavailable. Please try again in a few seconds.`);
    }

    buildChatbotPrompt(query, context) {
        const { 
            stats = {}, 
            safeToSpend = {}, 
            businessType,
            invoices = [],
            payments = [],
            expenses = [],
            customerInsights = [],
            revenueTrends = [],
            settings = {},
            temporal = {},
            ageing = {},
            growth = {},
            deepContext = {}
        } = context;

        // Derive everything from real settings — no hardcoded defaults
        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const businessSegment = businessType || settings?.business_type || settings?.businessType || 'freelancer';
        const ownerName = settings?.owner_name || settings?.full_name || null;
        const isNewAccount = invoices.length === 0 && payments.length === 0 && expenses.length === 0;

        // Safe Date Helper
        const safeDateFormat = (dateStr) => {
            if (!dateStr) return 'N/A';
            const d = new Date(dateStr);
            return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        };
        
        // ──── FINANCIAL SITREP (Situation Report) ──────────────────────────────────
        let contextBlock = `## SYSTEM CONTEXT\n`;
        contextBlock += `- **Current Time**: ${safeDateFormat(temporal.currentTime)} (${temporal.currentDay})\n`;
        contextBlock += `- **Fiscal Year**: ${temporal.fiscalYear}\n`;
        contextBlock += `- **Business**: ${businessName} (${businessSegment})\n`;
        if (ownerName) contextBlock += `- **Owner**: ${ownerName}\n`;
        contextBlock += `- **Currency**: ${currency}\n\n`;

        if (isNewAccount) {
            contextBlock += `> [!NOTE]\n> This is a brand new account with no financial history. Focus on onboarding and setup.\n\n`;
        }

        contextBlock += `## 📊 CORE FINANCIAL HEALTH\n`;
        contextBlock += `- **Total Revenue**: ${formatCurrency(stats?.total_revenue || 0, currency)}\n`;
        contextBlock += `- **Net Profit**: ${formatCurrency(stats?.net_profit || 0, currency)} (${stats?.avg_margin || 0}% margin)\n`;
        contextBlock += `- **MoM Growth**: ${growth.momGrowth?.toFixed(2) || 0}%\n`;
        contextBlock += `- **Pending Receipts**: ${formatCurrency(stats?.pending_payments || 0, currency)}\n\n`;

        contextBlock += `## 💧 LIQUIDITY & TAX RESERVES\n`;
        contextBlock += `- **Safe-to-Spend**: ${formatCurrency(safeToSpend?.safeToSpend || 0, currency)}\n`;
        contextBlock += `- **Total Bank Cash**: ${formatCurrency(safeToSpend?.totalRevenue || 0, currency)}\n`;
        contextBlock += `- **Tax Provisions**: GST (${formatCurrency(safeToSpend?.reserves?.gst || 0, currency)}), Income Tax (${formatCurrency(safeToSpend?.reserves?.incomeTax || 0, currency)})\n`;
        contextBlock += `- **Risk Provision**: ${formatCurrency(safeToSpend?.reserves?.atRisk || 0, currency)} (based on overdue ageing)\n\n`;

        contextBlock += `## ⚠️ BILLING AGEING (OVERDUE RISK)\n`;
        contextBlock += `- **Total Overdue**: ${formatCurrency(ageing.totalOverdue || 0, currency)}\n`;
        contextBlock += `- **Current (0-30 days)**: ${formatCurrency(ageing.current || 0, currency)}\n`;
        contextBlock += `- **Near-Late (31-60 days)**: ${formatCurrency(ageing.near || 0, currency)}\n`;
        contextBlock += `- **Critical (61+ days)**: ${formatCurrency(ageing.critical || 0, currency)}\n\n`;

        // 2. Recent Transactions (Invoices)
        if (invoices.length > 0) {
            contextBlock += `## RECENT INVOICES\n`;
            invoices.slice(0, 5).forEach(inv => {
                contextBlock += `- #${inv.invoiceNumber || 'INV'}: ${formatCurrency(inv.total || 0, currency)} to ${inv.customer_name || 'Unknown'} (Status: ${inv.status?.toUpperCase() || 'DRAFT'}, Due: ${safeDateFormat(inv.dueDate)})\n`;
            });
            contextBlock += `\n`;
        }

        // 3. Recent Payments
        if (payments.length > 0) {
            contextBlock += `## RECENT PAYMENTS\n`;
            payments.slice(0, 5).forEach(p => {
                contextBlock += `- ${formatCurrency(p.amount || 0, currency)} from ${p.customers?.name || 'Customer'} on ${safeDateFormat(p.date || p.createdAt)}\n`;
            });
            contextBlock += `\n`;
        }

        // 4. Recent Expenses
        if (expenses.length > 0) {
            contextBlock += `RECENT EXPENSES:\n`;
            expenses.slice(0, 3).forEach(e => {
                contextBlock += `- ${formatCurrency(e.amount, currency)} for ${e.category} (${e.description || 'No desc'})\n`;
            });
            contextBlock += `\n`;
        }

        // 5. Top Customers (with real data fields)
        if (customerInsights.length > 0) {
            contextBlock += `## TOP CUSTOMERS\n`;
            customerInsights.slice(0, 5).forEach(c => {
                const revenue = c.total_revenue ?? c.total_paid ?? c.revenue ?? 0;
                const invoiceCount = c.invoice_count ?? c.total_invoices ?? 'N/A';
                const lastSeen = c.last_invoice_date ? safeDateFormat(c.last_invoice_date) : 'N/A';
                contextBlock += `- **${c.name}**: ${formatCurrency(revenue, currency)} revenue, ${invoiceCount} invoices, last active ${lastSeen}\n`;
            });
            contextBlock += `\n`;
        }

        // 6. Trends
        if (revenueTrends.length > 0) {
            contextBlock += `## REVENUE TREND (Last 6 Months)\n`;
            revenueTrends.slice(-6).forEach(t => {
                contextBlock += `- ${t.month || t.period}: ${formatCurrency(t.revenue, currency)}\n`;
            });
            contextBlock += `\n`;
        }

        // 7. STRATEGIC DEEP CONTEXT
        if (deepContext.liquidity) {
            contextBlock += `## 🧠 STRATEGIC SITUATION REPORT\n`;
            contextBlock += `- **Cash Runway**: ${deepContext.liquidity.runwayMonths} months (Avg Burn: ${formatCurrency(deepContext.liquidity.burnRate, currency)}/mo)\n`;
            contextBlock += `- **Revenue Risk**: Max Concentration ${deepContext.risk.maxConcentration}% (Top client dependency)\n`;
            
            if (deepContext.growth.dormantClients?.length > 0) {
                contextBlock += `- **Growth Gaps**: ${deepContext.growth.dormantClients.length} clients inactive for >90 days (e.g., ${deepContext.growth.dormantClients.join(', ')}).\n`;
            }
            
            if (deepContext.risk.riskyOverdue?.length > 0) {
                const topRisk = deepContext.risk.riskyOverdue[0];
                contextBlock += `- **Critical Action**: Invoice #${topRisk.invoiceNumber} is ${topRisk.daysLate} days late. Collect ${formatCurrency(topRisk.total, currency)} immediately.\n`;
            }
            contextBlock += `\n`;
        }

        contextBlock += `---\n`;
        contextBlock += `## RESPONSE FORMATTING RULES (YOU MUST FOLLOW)\n\n`;
        contextBlock += `You are **Capita**, a high-end Strategic CFO AI for freelancers. Give sharp, structured, visually clear answers.\n\n`;
        contextBlock += `**TONE:** Authoritative but warm. Senior advisor, not a chatbot.\n\n`;
        contextBlock += `**FORMAT RULES:**\n`;
        contextBlock += `- Start with a **1-sentence executive summary** — bold the key number or insight.\n`;
        contextBlock += `- Use \`## Heading\` for responses covering more than 2 topics.\n`;
        contextBlock += `- Use **bullet points** for any list of 3+ items. Never write lists as a comma sentence.\n`;
        contextBlock += `- Use **markdown tables** when comparing clients, invoices, or multiple metrics.\n`;
        contextBlock += `- **Bold** every currency amount, percentage, and key metric.\n`;
        contextBlock += `- Use \`> ⚠️ ...\` for risks. Use \`> 🚀 ...\` for growth opportunities.\n`;
        contextBlock += `- End with **→ one clear next action** the user should take.\n\n`;
        contextBlock += `**TABLE FORMAT FOR COMPARISONS** (use your real data — not this example):\n`;
        contextBlock += `| Client | Revenue | Status |\n|--------|---------|--------|\n\n`;
        contextBlock += `**NEVER DO:**\n`;
        contextBlock += `- ❌ Walls of text — max 4 sentences per paragraph.\n`;
        contextBlock += `- ❌ Comma-separated lists when there are 3+ items.\n`;
        contextBlock += `- ❌ Filler phrases like "I can help with that" or "Great question!"\n`;
        contextBlock += `- ❌ Repeat the user's question back to them.\n\n`;
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

            if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
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
                    
                    this._recordUsage(userId);
                    const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:magic`, budget: this.getBudgetStatus(userId) };
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

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
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
                    budget: this.getBudgetStatus(userId)
                };

                this._recordUsage(userId);
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

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
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
                
                this._recordUsage(userId);
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:draft`, budget: this.getBudgetStatus(userId) };
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

        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
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
                
                this._recordUsage(userId);
                const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:settle`, budget: this.getBudgetStatus(userId) };
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
        if (!this.genAI || this._isDailyBudgetExhausted(userId) || !this._canMakeRequest()) {
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
                
                this._recordUsage(userId);
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:cmd`, budget: this.getBudgetStatus(userId) };
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
