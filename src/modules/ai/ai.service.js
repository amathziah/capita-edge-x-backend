import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { formatCurrency, getCurrencySymbol } from '../../core/utils/formatting.js';
import { supabase } from '../../core/database/supabase.js';
import analyticsService from '../analytics/analytics.service.js';
import aiReadModelService from './aiReadModel.service.js';
import aiToolRegistryService from './aiToolRegistry.service.js';
import { PLAN_TIERS } from '../../core/config/tierConfig.js';
import { brandProfile } from '../../core/config/brandProfile.js';

dotenv.config();

const AI_ACCESS_EXHAUSTED_MESSAGE = 'AI access is temporarily unavailable for this workspace right now. Upgrade or wait for the next usage cycle to continue.';

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

    async _countMonthlyUsageRecords(orgId, firstOfMonthIso) {
        const timestampColumns = ['createdAt', 'created_at'];

        for (const column of timestampColumns) {
            const { count, error } = await supabase
                .from('ai_requests')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .gte(column, firstOfMonthIso);

            if (!error) {
                return { count: count || 0, column };
            }
        }

        return { count: 0, column: null, error: new Error('Unable to resolve ai_requests timestamp column') };
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

        const usage = await this._countMonthlyUsageRecords(orgId, firstOfMonth.toISOString());
        if (usage.error) {
            console.error('Plan Budget Error (Usage Query):', usage.error);
            return { allowed: true, limit: queryLimit, used: 0 }; // Fail open
        }

        return {
            allowed: usage.count < queryLimit,
            used: usage.count,
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

    getModel(modelName, isJson = false, enableTools = true) {
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
        if (!isJson && enableTools) {
            config.tools = this.getToolDeclarations();
        }

        return this.genAI.getGenerativeModel(config);
    }

    buildEvidencePrompt(query, context = {}, execution = {}) {
        const {
            settings = {},
            temporal = {},
            businessType,
        } = context;

        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const rawBusinessSegment = businessType || settings?.business_type || settings?.businessType || 'solopreneur';
        const businessSegment = rawBusinessSegment === 'freelancer' ? 'solopreneur' : rawBusinessSegment;

        const personaInstructions = {
            solopreneur: 'Act like a pragmatic CFO for an Indian freelancer. Prioritise collections, runway, taxes, margins, and concrete next actions.',
            subscription: 'Act like a SaaS finance lead. Prioritise MRR quality, churn, retention, and forecast clarity.',
            services_firm: 'Act like a services finance lead. Prioritise utilisation, project margins, receivables, and delivery risk.',
            ecommerce: 'Act like a commerce finance operator. Prioritise margin, working capital, receivables, and cash conversion.'
        }[businessSegment] || 'Act like a pragmatic finance operator.';

        const evidenceLines = (execution.toolResults || []).map((entry, index) => {
            const payload = JSON.stringify({
                tool: entry.toolId,
                args: entry.args,
                data: entry.result?.data,
                meta: entry.result?.meta
            });
            return `TOOL_${index + 1}: ${payload}`;
        }).join('\n');

        return [
            'You are Capita, a grounded financial product agent.',
            personaInstructions,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'Rules:',
            '- Treat TOOL results as the only source of truth for user-specific numbers.',
            '- If a needed fact is missing from TOOL results, say so plainly.',
            '- Do not invent private data, metrics, customer names, totals, or dates.',
            '- Be concise, specific, and operationally useful.',
            '- When tool evidence exists, cite the relevant business object in plain language.',
            '- Personalize recommendations to the user business, cash position, receivables, expense profile, and compliance state when those facts are present in TOOL results.',
            '- If the user asks what to do next, rank the most important actions using the available evidence instead of giving generic business advice.',
            '- If the query is general knowledge and there are no tools, answer carefully without pretending to see private data.',
            '',
            `Execution mode: ${execution.mode || 'general'}`,
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'Respond in markdown with:',
            '1. A one-sentence executive answer.',
            '2. Short supporting bullets when useful.',
            '3. One clear next action.',
        ].join('\n');
    }

    buildGroundedJsonPrompt(query, context = {}, execution = {}) {
        const {
            settings = {},
            temporal = {},
            businessType,
        } = context;

        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const rawBusinessSegment = businessType || settings?.business_type || settings?.businessType || 'solopreneur';
        const businessSegment = rawBusinessSegment === 'freelancer' ? 'solopreneur' : rawBusinessSegment;

        const personaInstructions = {
            solopreneur: 'Act like a pragmatic CFO for an Indian freelancer. Prioritise collections, runway, taxes, margins, and concrete next actions.',
            subscription: 'Act like a SaaS finance lead. Prioritise MRR quality, churn, retention, and forecast clarity.',
            services_firm: 'Act like a services finance lead. Prioritise utilisation, project margins, receivables, and delivery risk.',
            ecommerce: 'Act like a commerce finance operator. Prioritise margin, working capital, receivables, and cash conversion.'
        }[businessSegment] || 'Act like a pragmatic finance operator.';

        const evidenceLines = (execution.toolResults || []).map((entry, index) => {
            const payload = JSON.stringify({
                tool: entry.toolId,
                args: entry.args,
                data: entry.result?.data,
                meta: entry.result?.meta
            });
            return `TOOL_${index + 1}: ${payload}`;
        }).join('\n');

        return [
            'You are Capita, a grounded financial product agent.',
            personaInstructions,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'Return valid JSON only. No markdown.',
            '',
            'Rules:',
            '- Treat TOOL results as the only source of truth for user-specific numbers, names, totals, dates, statuses, and business facts.',
            '- If a fact is missing, do not infer it. Say it is unavailable.',
            '- Do not cite tools that were not provided.',
            '- Every summary or supporting point that states a business fact must cite at least one tool.',
            '- `next_action` may be advice, but must not introduce new business facts.',
            '- If the user asks for priorities, recommendations, business health, or what to do next, tailor the answer to the business type and rank advice using the available evidence.',
            '- Keep the answer concise and operational.',
            '',
            `Execution mode: ${execution.mode || 'general'}`,
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'JSON schema:',
            '{',
            '  "summary": "string",',
            '  "bullets": [{"text": "string", "citations": [{"tool": "tool_id"}]}],',
            '  "next_action": "string",',
            '  "citations": [{"tool": "tool_id"}],',
            '  "verification_status": "grounded" | "insufficient_evidence" | "requires_professional_review"',
            '}'
        ].join('\n');
    }

    _normaliseClaimNumber(value) {
        if (value === null || value === undefined) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const cleaned = raw.replace(/,/g, '');
        const numeric = Number(cleaned.replace(/%$/, ''));
        if (!Number.isFinite(numeric)) return null;
        const suffix = cleaned.endsWith('%') ? '%' : '';
        return `${numeric}${suffix}`;
    }

    _extractClaimNumbers(text = '') {
        const matches = String(text).match(/\b\d[\d,]*(?:\.\d+)?%?\b/g) || [];
        return matches
            .map((value) => this._normaliseClaimNumber(value))
            .filter(Boolean);
    }

    _collectEvidenceFacts(value, accumulator = { numbers: new Set() }) {
        if (value === null || value === undefined) {
            return accumulator;
        }

        if (typeof value === 'number') {
            const normalised = this._normaliseClaimNumber(value);
            if (normalised) accumulator.numbers.add(normalised);
            return accumulator;
        }

        if (typeof value === 'string') {
            for (const numeric of this._extractClaimNumbers(value)) {
                accumulator.numbers.add(numeric);
            }
            return accumulator;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => this._collectEvidenceFacts(item, accumulator));
            return accumulator;
        }

        if (typeof value === 'object') {
            Object.values(value).forEach((item) => this._collectEvidenceFacts(item, accumulator));
        }

        return accumulator;
    }

    collectExecutionEvidence(execution = {}) {
        const toolIds = new Set();
        const numbers = new Set();

        for (const entry of execution.toolResults || []) {
            if (entry?.toolId) {
                toolIds.add(entry.toolId);
            }
            this._collectEvidenceFacts(entry?.result?.data, { numbers });
            this._collectEvidenceFacts(entry?.result?.meta, { numbers });
        }

        return {
            toolIds,
            numbers
        };
    }

    validateGroundedPayload(payload = {}, execution = {}, queryRisk = {}) {
        const issues = [];
        const evidence = this.collectExecutionEvidence(execution);
        const hasToolEvidence = Boolean((execution.toolResults || []).length);
        const citations = Array.isArray(payload.citations) ? payload.citations : [];
        const bullets = Array.isArray(payload.bullets) ? payload.bullets : [];

        if (!payload.summary || typeof payload.summary !== 'string') {
            issues.push('missing_summary');
        }

        if (!payload.next_action || typeof payload.next_action !== 'string') {
            issues.push('missing_next_action');
        }

        const citedTools = new Set();
        for (const citation of citations) {
            const toolId = citation?.tool;
            if (!toolId || !evidence.toolIds.has(toolId)) {
                issues.push('invalid_top_level_citation');
                continue;
            }
            citedTools.add(toolId);
        }

        for (const bullet of bullets) {
            if (!bullet?.text || typeof bullet.text !== 'string') {
                issues.push('invalid_bullet');
                continue;
            }

            const bulletCitations = Array.isArray(bullet.citations) ? bullet.citations : [];
            if (hasToolEvidence && bulletCitations.length === 0) {
                issues.push('uncited_bullet');
                continue;
            }

            for (const citation of bulletCitations) {
                const toolId = citation?.tool;
                if (!toolId || !evidence.toolIds.has(toolId)) {
                    issues.push('invalid_bullet_citation');
                    continue;
                }
                citedTools.add(toolId);
            }
        }

        if (hasToolEvidence && citedTools.size === 0) {
            issues.push('missing_citations');
        }

        const factualText = [
            payload.summary,
            ...bullets.map((bullet) => bullet?.text || '')
        ].join('\n');
        const unsupportedNumbers = this._extractClaimNumbers(factualText)
            .filter((number) => !evidence.numbers.has(number));

        if (hasToolEvidence && unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        const validStatuses = new Set(['grounded', 'insufficient_evidence', 'requires_professional_review']);
        if (!validStatuses.has(payload.verification_status)) {
            issues.push('invalid_verification_status');
        }

        if (queryRisk.highStakesDomain && payload.verification_status === 'grounded' && !hasToolEvidence) {
            issues.push('ungrounded_high_stakes_claim');
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    formatGroundedPayload(payload = {}) {
        const citations = (payload.citations || [])
            .map((citation) => citation?.tool)
            .filter(Boolean);
        const citationSuffix = citations.length > 0
            ? ` [Sources: ${Array.from(new Set(citations)).join(', ')}]`
            : '';

        const bulletLines = (payload.bullets || [])
            .filter((bullet) => bullet?.text)
            .map((bullet) => {
                const bulletSources = (bullet.citations || [])
                    .map((citation) => citation?.tool)
                    .filter(Boolean);
                const bulletSuffix = bulletSources.length > 0
                    ? ` [Source: ${Array.from(new Set(bulletSources)).join(', ')}]`
                    : '';
                return `- ${bullet.text}${bulletSuffix}`;
            });

        return [
            `${payload.summary || 'I do not have enough verified evidence to answer that.'}${citationSuffix}`,
            bulletLines.length > 0 ? '' : null,
            bulletLines.length > 0 ? bulletLines.join('\n') : null,
            '',
            `Next action: ${payload.next_action || 'Ask a narrower grounded question.'}`
        ].filter(Boolean).join('\n');
    }

    buildToolBackedFallbackAnswer(query = '', execution = {}) {
        const lowerQuery = String(query || '').toLowerCase();
        const sections = [];
        const nextActions = [];
        let dashboardSnapshot = null;
        let invoiceWorkspace = null;
        let paymentWorkspace = null;
        let expenseWorkspace = null;
        let complianceWorkspace = null;
        let recentActivity = null;

        for (const entry of execution.toolResults || []) {
            const toolId = entry?.toolId;
            const data = entry?.result?.data || {};
            const currency = data?.currency || entry?.result?.meta?.currency || 'INR';

            if (toolId === 'get_business_advisor_context') {
                dashboardSnapshot = data.snapshot || dashboardSnapshot;
                recentActivity = data.recentActivity || recentActivity;
                invoiceWorkspace = data.invoices || invoiceWorkspace;
                paymentWorkspace = data.payments || paymentWorkspace;
                expenseWorkspace = data.expenses || expenseWorkspace;
                complianceWorkspace = data.compliance || complianceWorkspace;
            }

            if (toolId === 'get_dashboard_snapshot') dashboardSnapshot = data;
            if (toolId === 'get_invoice_workspace') invoiceWorkspace = data;
            if (toolId === 'get_payment_workspace') paymentWorkspace = data;
            if (toolId === 'get_expense_workspace') expenseWorkspace = data;
            if (toolId === 'get_compliance_workspace') complianceWorkspace = data;
            if (toolId === 'get_recent_activity') recentActivity = data;

            if (toolId === 'get_dashboard_snapshot') {
                const stats = data.stats || {};
                const safeToSpend = data.safeToSpend || {};
                const monthlyBurn = Number(safeToSpend.totalExpenses || stats.total_expenses || 0);
                const availableLiquidity = Number(safeToSpend.safeToSpend || 0);
                const estimatedRunwayMonths = monthlyBurn > 0
                    ? Number((availableLiquidity / monthlyBurn).toFixed(1))
                    : null;

                if (lowerQuery.includes('runway')) {
                    if (estimatedRunwayMonths === null) {
                        return [
                            'I can estimate runway only when there is a non-zero expense trend to compare against current safe-to-spend cash.',
                            '',
                            `Verified liquidity right now is ${formatCurrency(availableLiquidity, currency)}, but monthly burn is not high enough in the available data to compute a stable runway estimate.`,
                            '',
                            'Next action: review current expenses and cash reserves before using runway as a decision metric.'
                        ].join('\n');
                    }

                    return [
                        `Estimated cash runway is about ${estimatedRunwayMonths} months based on verified safe-to-spend liquidity of ${formatCurrency(availableLiquidity, currency)} and recorded expenses of ${formatCurrency(monthlyBurn, currency)} in the current trend window.`,
                        '',
                        `- Cash on hand: ${formatCurrency(safeToSpend.cashOnHand || 0, currency)}.`,
                        `- Protected reserves and risk buffers: ${formatCurrency((safeToSpend.reserves?.gst || 0) + (safeToSpend.reserves?.incomeTax || 0) + (safeToSpend.reserves?.atRisk || 0), currency)}.`,
                        '',
                        'Next action: treat this as an operating estimate and tighten collections if you want to extend runway.'
                    ].join('\n');
                }

                if (lowerQuery.includes('safe to spend') || lowerQuery.includes('cash flow') || lowerQuery.includes('cashflow')) {
                    return [
                        `Verified safe-to-spend cash is ${formatCurrency(availableLiquidity, currency)}.`,
                        '',
                        `- Cash on hand: ${formatCurrency(safeToSpend.cashOnHand || 0, currency)}.`,
                        `- Total recorded expenses: ${formatCurrency(monthlyBurn, currency)}.`,
                        `- Reserve buffer: ${formatCurrency((safeToSpend.reserves?.gst || 0) + (safeToSpend.reserves?.incomeTax || 0) + (safeToSpend.reserves?.atRisk || 0), currency)}.`,
                        '',
                        'Next action: preserve buffer for tax and overdue-risk reserves before committing new spend.'
                    ].join('\n');
                }
            }

            if (toolId === 'get_recent_activity' && (
                lowerQuery.includes('recent activity') ||
                lowerQuery.includes('what happened recently') ||
                lowerQuery.includes('latest activity')
            )) {
                const invoices = Array.isArray(data.invoices) ? data.invoices : [];
                const payments = Array.isArray(data.payments) ? data.payments : [];
                const expenses = Array.isArray(data.expenses) ? data.expenses : [];

                return [
                    'Recent business activity from your live data:',
                    '',
                    invoices.length > 0 ? `- Invoices: ${invoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : '- Invoices: no recent invoice activity found.',
                    payments.length > 0 ? `- Payments: ${payments.slice(0, 2).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : '- Payments: no recent payment activity found.',
                    expenses.length > 0 ? `- Expenses: ${expenses.slice(0, 2).map((expense) => `${expense.description || expense.category || 'expense'} (${formatCurrency(expense.amount || 0, currency)} on ${expense.date || 'unknown date'})`).join('; ')}.` : '- Expenses: no recent expense activity found.',
                    '',
                    'Next action: reconcile the most recent cash movements and confirm they match open invoices and planned spend.'
                ].join('\n');
            }

            if (toolId === 'get_invoice_workspace') {
                const summary = data.summary || {};
                const overdueInvoices = Array.isArray(data.overdueInvoices) ? data.overdueInvoices : [];
                const recentInvoices = Array.isArray(data.recentInvoices) ? data.recentInvoices : [];
                const topAttention = overdueInvoices.slice(0, 3)
                    .map((invoice) => `#${invoice.invoiceNumber} (${invoice.daysOverdue || 0} days overdue, ${formatCurrency(invoice.balanceDue || 0, currency)})`);

                sections.push([
                    `Receivables needing action: ${summary.totalInvoices || 0} invoices tracked, ${formatCurrency(summary.totalOutstanding || 0, currency)} still outstanding, and ${formatCurrency(summary.overdueAmount || 0, currency)} already overdue.`,
                    topAttention.length > 0 ? `- Priority invoices: ${topAttention.join('; ')}.` : null,
                    recentInvoices.length > 0 ? `- Recent invoice activity: ${recentInvoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                if (topAttention.length > 0) {
                    nextActions.push(`follow up first on ${topAttention[0].split(' ')[0]}`);
                } else {
                    nextActions.push('review unpaid invoices and send reminders');
                }
            }

            if (toolId === 'get_payment_workspace') {
                const summary = data.summary || {};
                const recentPayments = Array.isArray(data.recentPayments) ? data.recentPayments : [];

                sections.push([
                    `Payments snapshot: ${summary.completedCount || 0} completed payments recorded, ${formatCurrency(summary.totalCollected || 0, currency)} collected overall, and ${formatCurrency(summary.collectedThisMonth || 0, currency)} collected this month.`,
                    recentPayments.length > 0 ? `- Recent receipts: ${recentPayments.slice(0, 3).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('reconcile the latest completed payments against open invoices');
            }

            if (toolId === 'get_expense_workspace') {
                const summary = data.summary || {};
                const topCategories = Array.isArray(data.topCategories) ? data.topCategories : [];

                sections.push([
                    `Expense snapshot: ${summary.totalExpenses || 0} expenses recorded, ${formatCurrency(summary.totalSpend || 0, currency)} total spend, and ${formatCurrency(summary.spendThisMonth || 0, currency)} spent this month.`,
                    topCategories.length > 0 ? `- Largest categories: ${topCategories.slice(0, 3).map((entry) => `${entry.category} (${formatCurrency(entry.amount || 0, currency)})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('review the highest spend categories for controllable costs');
            }

            if (toolId === 'get_compliance_workspace') {
                const summary = data.summary || {};
                const urgentTasks = Array.isArray(data.urgentTasks) ? data.urgentTasks : [];

                sections.push([
                    `Compliance snapshot: ${summary.totalTasks || 0} tracked tasks, ${summary.pendingCount || 0} pending, ${summary.overdueCount || 0} overdue, and ${summary.dueThisWeekCount || 0} due this week.`,
                    urgentTasks.length > 0 ? `- Urgent items: ${urgentTasks.slice(0, 3).map((task) => `${task.title || task.name || 'task'} (${task.status}${task.due_date ? `, due ${task.due_date}` : ''})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('clear overdue compliance items before upcoming deadlines');
            }
        }

        if (
            recentActivity &&
            (lowerQuery.includes('recent activity') ||
                lowerQuery.includes('what happened recently') ||
                lowerQuery.includes('latest activity') ||
                lowerQuery.includes('what happened in the business'))
        ) {
            const currency = recentActivity.currency || dashboardSnapshot?.currency || 'INR';
            const invoices = Array.isArray(recentActivity.invoices) ? recentActivity.invoices : [];
            const payments = Array.isArray(recentActivity.payments) ? recentActivity.payments : [];
            const expenses = Array.isArray(recentActivity.expenses) ? recentActivity.expenses : [];

            return [
                'Recent business activity from your live data:',
                '',
                invoices.length > 0 ? `- Invoices: ${invoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : '- Invoices: no recent invoice activity found.',
                payments.length > 0 ? `- Payments: ${payments.slice(0, 2).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : '- Payments: no recent payment activity found.',
                expenses.length > 0 ? `- Expenses: ${expenses.slice(0, 2).map((expense) => `${expense.description || expense.category || 'expense'} (${formatCurrency(expense.amount || 0, currency)} on ${expense.date || 'unknown date'})`).join('; ')}.` : '- Expenses: no recent expense activity found.',
                '',
                'Next action: reconcile the latest cash movements and confirm they align with expected collections and planned spend.'
            ].join('\n');
        }

        if (
            dashboardSnapshot &&
            (lowerQuery.includes('how is the business doing') ||
                lowerQuery.includes('how are we doing') ||
                lowerQuery.includes('financial health') ||
                lowerQuery.includes('business health') ||
                lowerQuery.includes('financial position') ||
                lowerQuery.includes('finance') ||
                lowerQuery.includes('business performance'))
        ) {
            const currency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};

            return [
                `The business is currently operating with ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)} of verified safe-to-spend cash, ${formatCurrency(snapshotStats.pending_payments || 0, currency)} still pending from customers, and ${formatCurrency(snapshotStats.overdue_revenue || 0, currency)} already overdue.`,
                '',
                `- Revenue collected from paid invoices: ${formatCurrency(snapshotStats.total_revenue || 0, currency)}.`,
                `- Total recorded expenses: ${formatCurrency(snapshotStats.total_expenses || 0, currency)}.`,
                `- Net profit from current records: ${formatCurrency(snapshotStats.net_profit || 0, currency)} with a ${snapshotStats.profit_margin || 0}% margin.`,
                '',
                `Next action: ${nextActions[0] || 'review receivables, liquidity, and current cost pressure before making new commitments.'}`
            ].join('\n');
        }

        if (
            dashboardSnapshot &&
            (lowerQuery.includes('focus') ||
                lowerQuery.includes('priority') ||
                lowerQuery.includes('priorities') ||
                lowerQuery.includes('what should i do') ||
                lowerQuery.includes('what should we do') ||
                lowerQuery.includes('how are we doing') ||
                lowerQuery.includes('business health') ||
                lowerQuery.includes('biggest risk') ||
                lowerQuery.includes('best move'))
        ) {
            const currency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};
            const overdueAmount = Number(invoiceWorkspace?.summary?.overdueAmount || snapshotStats.overdue_revenue || 0);
            const outstandingAmount = Number(invoiceWorkspace?.summary?.totalOutstanding || snapshotStats.pending_payments || 0);
            const spendThisMonth = Number(expenseWorkspace?.summary?.spendThisMonth || snapshotLiquidity.totalExpenses || 0);
            const dueThisWeek = Number(complianceWorkspace?.summary?.dueThisWeekCount || 0) + Number(complianceWorkspace?.summary?.overdueCount || 0);
            const collectedThisMonth = Number(paymentWorkspace?.summary?.collectedThisMonth || 0);
            const priorities = [];

            if (overdueAmount > 0) {
                priorities.push(`Collections is the top priority because ${formatCurrency(overdueAmount, currency)} is already overdue and ${formatCurrency(outstandingAmount, currency)} is still outstanding.`);
            }
            if (dueThisWeek > 0) {
                priorities.push(`Compliance needs attention because ${dueThisWeek} items are overdue or due this week.`);
            }
            if (spendThisMonth > collectedThisMonth && spendThisMonth > 0) {
                priorities.push(`Cash discipline matters because this month spend of ${formatCurrency(spendThisMonth, currency)} is ahead of recorded collections of ${formatCurrency(collectedThisMonth, currency)}.`);
            }
            if (priorities.length === 0) {
                priorities.push(`The business looks stable from current records, with ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)} of verified safe-to-spend cash and no immediate red flags in the retrieved workspaces.`);
            }

            return [
                priorities[0],
                '',
                ...priorities.slice(1).map((line) => `- ${line}`),
                snapshotLiquidity.safeToSpend !== undefined ? `- Verified safe-to-spend cash: ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)}.` : null,
                '',
                `Next action: ${nextActions[0] || 'review the highest-risk item first and then recheck cash position.'}`
            ].filter(Boolean).join('\n');
        }

        if (sections.length === 0) {
            return this.buildUnverifiedAnswer({}, ['no_tool_fallback_available']);
        }

        const uniqueActions = Array.from(new Set(nextActions));
        return [
            sections.join('\n\n'),
            '',
            `Next action: ${uniqueActions[0] || 'Ask a narrower grounded question.'}.`
        ].join('\n');
    }

    parseJsonText(rawText = '') {
        return JSON.parse(
            String(rawText || '')
                .trim()
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim()
        );
    }

    buildGenericValidationError(message = 'The AI response could not be verified safely.') {
        return new Error(message);
    }

    validateInvoiceExtractionPayload(payload = {}, sourceText = '') {
        const issues = [];
        const sourceNumbers = this._extractClaimNumbers(sourceText);
        const payloadNumbers = Array.from(this._collectEvidenceFacts(payload).numbers);

        for (const number of payloadNumbers) {
            if (!sourceNumbers.includes(number)) {
                issues.push(`unsupported_numbers:${number}`);
            }
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateAuditPayload(payload = {}, invoiceData = {}) {
        const issues = [];
        if (!Number.isFinite(payload.riskScore) || payload.riskScore < 0 || payload.riskScore > 100) {
            issues.push('invalid_risk_score');
        }
        if (!Array.isArray(payload.suggestions) || payload.suggestions.some((entry) => typeof entry !== 'string')) {
            issues.push('invalid_suggestions');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'invoice_input', result: { data: invoiceData, meta: {} } }]
        }).numbers;
        const suggestionNumbers = this._extractClaimNumbers((payload.suggestions || []).join('\n'));
        const unsupportedNumbers = suggestionNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateCollectionDraftPayload(payload = {}, invoice = {}) {
        const issues = [];
        if (typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
            issues.push('missing_subject');
        }
        if (typeof payload.body !== 'string' || payload.body.trim().length === 0) {
            issues.push('missing_body');
        }
        if ('discountOffered' in payload && typeof payload.discountOffered !== 'boolean') {
            issues.push('invalid_discount_flag');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'invoice_input', result: { data: invoice, meta: {} } }]
        }).numbers;
        const draftNumbers = this._extractClaimNumbers(`${payload.subject || ''}\n${payload.body || ''}`);
        const unsupportedNumbers = draftNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateCommandPayload(payload = {}) {
        const issues = [];
        const validTypes = new Set(['create_customer', 'unknown']);

        if (!validTypes.has(payload.type)) {
            issues.push('invalid_type');
        }

        if (payload.type === 'create_customer') {
            if (!payload.data || typeof payload.data !== 'object') {
                issues.push('missing_data');
            } else if (typeof payload.data.name !== 'string' || payload.data.name.trim().length === 0) {
                issues.push('missing_customer_name');
            }
        }

        if (payload.message !== undefined && typeof payload.message !== 'string') {
            issues.push('invalid_message');
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateAgentPayload(payload = {}, contextData = {}) {
        const issues = [];
        if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
            issues.push('missing_text');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'agent_context', result: { data: contextData, meta: {} } }]
        }).numbers;
        const payloadNumbers = this._extractClaimNumbers(payload.text || '');
        const unsupportedNumbers = payloadNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    async safeJsonModelCall({
        prompt,
        cacheKey = null,
        cacheTtl = null,
        validator = null,
        sanitise = null,
        providerSuffix = 'json'
    } = {}) {
        if (cacheKey) {
            const cached = this._cacheGet(cacheKey);
            if (cached) {
                return { ...cached, provider: `${cached.provider}:cached` };
            }
        }

        if (!this.genAI || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI structured generation is currently unavailable.');
        }

        for (const modelName of this.models) {
            try {
                this._consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = this.parseJsonText(response.text());
                const validation = validator ? validator(parsed) : { ok: true, issues: [] };

                if (!validation.ok) {
                    throw this.buildGenericValidationError(`AI verification failed: ${validation.issues.join(', ')}`);
                }

                const base = sanitise ? sanitise(parsed) : parsed;
                const responseData = {
                    ...base,
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:${providerSuffix}`
                };

                if (cacheKey && cacheTtl) {
                    this._cacheSet(cacheKey, responseData, cacheTtl);
                }

                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                throw error;
            }
        }

        throw new Error('Cloud Busy: Unable to complete structured AI request safely.');
    }

    async buildToolBackedExecution(query, context = {}) {
        const plannedTools = await aiToolRegistryService.planTools(query, context);
        const toolResults = [];

        for (const step of plannedTools) {
            const definition = aiToolRegistryService.getToolDefinition(step.toolId);
            const result = await aiToolRegistryService.executeTool(step.toolId, context, step.args || {});
            toolResults.push({
                toolId: step.toolId,
                label: definition?.label || step.toolId,
                uiComponent: definition?.uiComponent || null,
                args: step.args || {},
                result
            });
        }

        return {
            mode: plannedTools.length > 0 ? 'grounded' : 'general',
            toolResults
        };
    }

    analyzeQueryRisk(query, execution = {}) {
        const text = String(query || '').toLowerCase();
        const hasToolEvidence = Boolean((execution.toolResults || []).length);
        const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasBoundedPhrase = (signal) => {
            const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(signal.toLowerCase())}([^a-z0-9]|$)`, 'i');
            return pattern.test(text);
        };

        const privateDataSignals = [
            'my ', 'our ', 'business', 'workspace', 'dashboard', 'revenue', 'profit',
            'margin', 'cash flow', 'cashflow', 'safe to spend', 'overdue', 'invoice',
            'invoices', 'customer', 'customers', 'client', 'clients', 'payment', 'payments',
            'expense', 'expenses', 'receivable', 'receivables', 'runway'
        ];
        const temporalSignals = [
            'today', 'current', 'currently', 'latest', 'recent', 'recently',
            'right now', 'as of', 'this week', 'this month', 'this quarter', 'this year'
        ];
        const highStakesSignals = [
            'legal', 'law', 'gst', 'tds', 'tax', 'compliance', 'penalty', 'interest',
            'file return', 'filing', 'medical', 'diagnose', 'prescription', 'investment',
            'stock', 'sebi', 'contract'
        ];
        const domainSignals = [
            'invoice', 'invoices', 'payment', 'payments', 'expense', 'expenses',
            'compliance', 'gst', 'tds', 'receivable', 'receivables', 'vendor', 'vendors',
            'billing', 'receipt', 'reconcile', 'filing', 'return', 'deadline'
        ];
        const conversationalSafeSignals = [
            'hi', 'hello', 'hey', 'how are you', 'who are you', 'what can you do',
            'help', 'thanks', 'thank you', 'good morning', 'good evening',
            'good afternoon', 'good night', 'how are you doing', 'how are you doing these days',
            'what are the things you can do', 'can you help', 'are you online'
        ];

        const asksForPrivateData = privateDataSignals.some((signal) => text.includes(signal));
        const asksForCurrentInfo = temporalSignals.some((signal) => text.includes(signal));
        const highStakesDomain = highStakesSignals.some((signal) => text.includes(signal));
        const isDomainQuestion = domainSignals.some((signal) => text.includes(signal));
        const isConversationalSafe = conversationalSafeSignals.some((signal) => hasBoundedPhrase(signal));
        const requestsGuarantee = ['100%', 'guarantee', 'guaranteed', 'always correct', 'perfect answer']
            .some((signal) => text.includes(signal));

        const shouldRefuseGeneralAnswer = !hasToolEvidence && !isConversationalSafe && (
            asksForPrivateData ||
            highStakesDomain ||
            isDomainQuestion
        );

        const confidence = hasToolEvidence ? 'grounded' : (shouldRefuseGeneralAnswer ? 'blocked' : 'general');

        return {
            hasToolEvidence,
            asksForPrivateData,
            asksForCurrentInfo,
            highStakesDomain,
            isDomainQuestion,
            isConversationalSafe,
            requestsGuarantee,
            shouldRefuseGeneralAnswer,
            confidence
        };
    }

    buildSafetyMetadata(execution = {}, queryRisk = {}) {
        return {
            confidence: queryRisk.confidence || 'general',
            grounded: Boolean(queryRisk.hasToolEvidence),
            blocked: Boolean(queryRisk.shouldRefuseGeneralAnswer),
            requiresVerification: Boolean(!queryRisk.hasToolEvidence && queryRisk.highStakesDomain),
            provenance: (execution.toolResults || []).map((entry) => ({
                tool: entry.toolId,
                source: entry.result?.meta?.source || null,
                generated_at: entry.result?.meta?.generated_at || null
            }))
        };
    }

    buildUnsupportedAnswer(queryRisk = {}) {
        const reasons = [];

        if (queryRisk.asksForPrivateData) {
            reasons.push('your workspace-specific data was not retrieved by a tool');
        }

        if (queryRisk.asksForCurrentInfo && queryRisk.highStakesDomain) {
            reasons.push('the question needs current high-stakes verification');
        }

        const reasonText = reasons.length > 0
            ? reasons.join(' and ')
            : 'the answer cannot be verified safely from the current context';

        return [
            `I can’t answer that as certain fact because ${reasonText}.`,
            '',
            '- I only treat tool results as authoritative for private business metrics.',
            '- For changing legal, tax, or compliance rules, this system should verify the latest source before speaking with certainty.',
            '- Ask a grounded workspace question or provide a narrower general question that does not depend on current private data.',
            '',
            '→ Next action: rephrase the question so it can be answered from available tools or verified sources.'
        ].join('\n');
    }

    buildUnverifiedAnswer(queryRisk = {}, issues = []) {
        const issueText = issues.length > 0 ? ` The verification step rejected the draft for: ${issues.join(', ')}.` : '';
        return [
            `I’m not returning an AI-generated answer because it could not be verified against the backend evidence.${issueText}`,
            '',
            '- This system now rejects answers that cite missing tools or introduce unsupported business facts.',
            '- Ask a narrower question, or retrieve the needed data first so the response can be grounded.',
            queryRisk.highStakesDomain
                ? '- For tax, legal, compliance, or other high-stakes topics, treat AI output as support material and get professional review.'
                : '- The safest next step is to ask for a specific metric, customer, invoice group, or time window.',
            '',
            '→ Next action: ask a more specific grounded question.'
        ].join('\n');
    }

    async generateGroundedAnswer(query, context = {}, execution = {}) {
        const userId = context.user?.id || 'anon';
        const orgId = context.organizationId;
        const budget = await this._checkPlanBudget(orgId);
        const queryRisk = this.analyzeQueryRisk(query, execution);

        if (queryRisk.shouldRefuseGeneralAnswer) {
            return {
                text: this.buildUnsupportedAnswer(queryRisk),
                action: null,
                data: this.buildSafetyMetadata(execution, queryRisk),
                usage: null,
                provider: 'system:safety_guard',
                budget: await this.getBudgetStatus(userId, orgId)
            };
        }

        if (!this.genAI || this.isCircuitOpen() || !budget.allowed || !this._canMakeRequest()) {
            if (!budget.allowed) {
                throw new Error(AI_ACCESS_EXHAUSTED_MESSAGE);
            }
            throw new Error('Cloud Busy: AI engine is currently in cooldown. Please try again in 60s.');
        }

        const prompt = execution.toolResults?.length
            ? this.buildGroundedJsonPrompt(query, context, execution)
            : this.buildEvidencePrompt(query, context, execution);
        const rawHistory = context.history || [];
        const history = this._sanitiseHistory(rawHistory);
        const targetModels = budget.models || this.models;
        let lastError = null;

        for (const modelName of targetModels) {
            try {
                this._consumeToken();
                const useJsonMode = Boolean(execution.toolResults?.length);
                const modelInstance = this.getModel(modelName, useJsonMode, false);
                if (!modelInstance) continue;

                const chat = modelInstance.startChat({ history });
                const result = await chat.sendMessage(prompt);
                const response = await result.response;
                const budgetStatus = await this.getBudgetStatus(userId, orgId);
                const rawText = response.text().trim();

                if (useJsonMode) {
                    let payload = null;
                    try {
                        payload = JSON.parse(rawText);
                    } catch {
                        payload = null;
                    }

                    const validation = this.validateGroundedPayload(payload || {}, execution, queryRisk);
                    if (!payload || !validation.ok || payload.verification_status === 'insufficient_evidence') {
                        const fallbackText = execution.toolResults?.length
                            ? this.buildToolBackedFallbackAnswer(query, execution)
                            : this.buildUnverifiedAnswer(queryRisk, validation.issues);
                        return {
                            text: fallbackText,
                            action: null,
                            data: {
                                ...this.buildSafetyMetadata(execution, queryRisk),
                                verificationIssues: validation.issues,
                                usedToolFallback: Boolean(execution.toolResults?.length)
                            },
                            usage: response.usageMetadata,
                            provider: execution.toolResults?.length
                                ? `system:grounding_fallback:${modelName}`
                                : `system:grounding_guard:${modelName}`,
                            budget: budgetStatus
                        };
                    }

                    return {
                        text: this.formatGroundedPayload(payload),
                        action: this.extractAction(payload.next_action, query),
                        data: {
                            ...this.buildSafetyMetadata(execution, queryRisk),
                            verificationStatus: payload.verification_status
                        },
                        usage: response.usageMetadata,
                        provider: `cloud:${modelName}:orchestrated`,
                        budget: budgetStatus
                    };
                }

                return {
                    text: rawText,
                    action: this.extractAction(rawText, query),
                    data: this.buildSafetyMetadata(execution, queryRisk),
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:orchestrated`,
                    budget: budgetStatus
                };
            } catch (error) {
                lastError = error;
                if (this.isRetryable(error)) continue;
                break;
            }
        }

        throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
    }

    async *generateGroundedAnswerStream(query, context = {}, execution = {}) {
        const userId = context.user?.id || 'anon';
        const orgId = context.organizationId;
        const budget = await this._checkPlanBudget(orgId);
        const queryRisk = this.analyzeQueryRisk(query, execution);

        if (queryRisk.shouldRefuseGeneralAnswer) {
            yield {
                type: 'complete',
                text: this.buildUnsupportedAnswer(queryRisk),
                action: null,
                usage: null,
                provider: 'system:safety_guard',
                budget: await this.getBudgetStatus(userId, orgId),
                data: this.buildSafetyMetadata(execution, queryRisk)
            };
            return;
        }

        if (!budget.allowed) {
            throw new Error(AI_ACCESS_EXHAUSTED_MESSAGE);
        }
        if (!this.genAI || this.isCircuitOpen() || !this._canMakeRequest()) {
            throw new Error('Cloud Busy: AI engine is currently in cooldown. Please try again in 60s.');
        }

        const prompt = execution.toolResults?.length
            ? this.buildGroundedJsonPrompt(query, context, execution)
            : this.buildEvidencePrompt(query, context, execution);
        const rawHistory = context.history || [];
        const history = this._sanitiseHistory(rawHistory);
        const targetModels = budget.models || this.models;
        let fullText = '';
        let lastError = null;

        for (const modelName of targetModels) {
            try {
                this._consumeToken();
                const useJsonMode = Boolean(execution.toolResults?.length);
                const modelInstance = this.getModel(modelName, useJsonMode, false);
                if (!modelInstance) continue;

                const chat = modelInstance.startChat({ history });
                const currentResult = await chat.sendMessageStream(prompt);

                for await (const chunk of currentResult.stream) {
                    try {
                        const chunkText = chunk.text();
                        if (chunkText) {
                            fullText += chunkText;
                            if (!useJsonMode) {
                                yield { type: 'token', text: chunkText };
                            }
                        }
                    } catch {
                        // Ignore empty chunks
                    }
                }

                const finalResponse = await currentResult.response;
                const budgetStatus = await this.getBudgetStatus(userId, orgId);

                const rawText = fullText.trim();

                if (useJsonMode) {
                    let payload = null;
                    try {
                        payload = JSON.parse(rawText);
                    } catch {
                        payload = null;
                    }

                    const validation = this.validateGroundedPayload(payload || {}, execution, queryRisk);
                    if (!payload || !validation.ok || payload.verification_status === 'insufficient_evidence') {
                        const fallbackText = execution.toolResults?.length
                            ? this.buildToolBackedFallbackAnswer(query, execution)
                            : this.buildUnverifiedAnswer(queryRisk, validation.issues);
                        yield {
                            type: 'complete',
                            text: fallbackText,
                            action: null,
                            usage: finalResponse?.usageMetadata,
                            provider: execution.toolResults?.length
                                ? `system:grounding_fallback:${modelName}`
                                : `system:grounding_guard:${modelName}`,
                            budget: budgetStatus,
                            data: {
                                ...this.buildSafetyMetadata(execution, queryRisk),
                                verificationIssues: validation.issues,
                                usedToolFallback: Boolean(execution.toolResults?.length)
                            }
                        };
                        return;
                    }

                    yield {
                        type: 'complete',
                        text: this.formatGroundedPayload(payload),
                        action: this.extractAction(payload.next_action, query),
                        usage: finalResponse?.usageMetadata,
                        provider: `cloud:${modelName}:orchestrated`,
                        budget: budgetStatus,
                        data: {
                            ...this.buildSafetyMetadata(execution, queryRisk),
                            verificationStatus: payload.verification_status
                        }
                    };
                    return;
                }

                yield {
                    type: 'complete',
                    text: rawText,
                    action: this.extractAction(fullText, query),
                    usage: finalResponse?.usageMetadata,
                    provider: `cloud:${modelName}:orchestrated`,
                    budget: budgetStatus,
                    data: this.buildSafetyMetadata(execution, queryRisk)
                };
                return;
            } catch (error) {
                lastError = error;
                if (this.isRetryable(error)) {
                    fullText = '';
                    continue;
                }
                break;
            }
        }

        throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
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
                    const snapshot = await aiReadModelService.getDashboardSnapshot(orgId);
                    return {
                        ...snapshot.data,
                        _meta: snapshot.meta
                    };
                }
                
                case "get_overdue_invoices": {
                    const receivables = await aiReadModelService.getOverdueReceivables(orgId);
                    return {
                        ...receivables.data,
                        _meta: receivables.meta
                    };
                }

                case "get_recent_transactions": {
                    const activity = await aiReadModelService.getRecentActivity(orgId);
                    return {
                        ...activity.data,
                        _meta: activity.meta
                    };
                }

                case "get_customer_insights": {
                    const portfolio = await aiReadModelService.getCustomerPortfolio(orgId);
                    return {
                        ...portfolio.data,
                        _meta: portfolio.meta
                    };
                }

                case "get_customer_details": {
                    const customerId = funcCall.args?.customer_id;
                    if (!customerId) return { error: "Customer ID is required." };
                    const detail = await aiReadModelService.getCustomerDetail(orgId, customerId);
                    return {
                        ...detail.data,
                        _meta: detail.meta
                    };
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

    shouldEmitGenerativeUI(componentName, query = '') {
        const q = query.toLowerCase();

        if (componentName === 'get_financial_summary') {
            return [
                'summary',
                'overview',
                'dashboard',
                'revenue',
                'profit',
                'cash flow',
                'cashflow',
                'margin',
                'metrics',
                'business health',
                'safe to spend',
                'runway',
            ].some(keyword => q.includes(keyword));
        }

        if (componentName === 'get_overdue_invoices') {
            return [
                'overdue',
                'who owes me',
                'late payment',
                'late invoice',
                'receivable',
                'aging',
                'ageing',
                'pending payment',
                'collections',
            ].some(keyword => q.includes(keyword));
        }

        if (componentName === 'get_recent_transactions') {
            return [
                'recent transactions',
                'recent activity',
                'latest transactions',
                'latest payments',
                'latest expenses',
                'last 5',
                'recent invoices',
                'what happened recently',
            ].some(keyword => q.includes(keyword));
        }

        if (componentName === 'get_customer_insights') {
            return [
                'top customers',
                'top clients',
                'customer portfolio',
                'client portfolio',
                'customer insights',
                'client insights',
                'best customers',
                'best clients',
            ].some(keyword => q.includes(keyword));
        }

        if (componentName === 'get_customer_details') {
            return [
                'specific customer',
                'specific client',
                'customer health',
                'client health',
                'churn risk',
                'next purchase',
                'customer details',
                'client details',
            ].some(keyword => q.includes(keyword));
        }

        return false;
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
        const execution = await this.buildToolBackedExecution(query, context);
        return this.generateGroundedAnswer(query, context, execution);
    }

    /**
     * Process queries with streaming support (ChatGPT style)
     * Yields chunks of tokens to the client via a callback or generator
     */
    async *processQueryStream(query, context = {}) {
        const execution = await this.buildToolBackedExecution(query, context);
        for (const toolResult of execution.toolResults || []) {
            if (toolResult.uiComponent) {
                yield {
                    type: 'gen_ui',
                    component: toolResult.uiComponent,
                    data: toolResult.result?.data
                };
            }
        }
        yield* this.generateGroundedAnswerStream(query, context, execution);
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

        const response = await this.safeJsonModelCall({
            providerSuffix: 'agent',
            prompt: `${systemPrompt}
Return strict JSON only: { "text": string }.
Use only facts present in the supplied query and agent context.`,
            validator: (payload) => this.validateAgentPayload(payload, contextData),
            sanitise: (payload) => ({
                text: payload.text.trim()
            })
        });

        return {
            ...response,
            budget: await this.getBudgetStatus(userId, orgId)
        };
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
        const rawBusinessSegment = businessType || settings?.business_type || settings?.businessType || 'solopreneur';
        const businessSegment = rawBusinessSegment === 'freelancer' ? 'solopreneur' : rawBusinessSegment;
        const ownerName = settings?.owner_name || settings?.full_name || null;
        const personaInstructions = {
            solopreneur: 'Speak like a sharp CFO for an Indian freelancer. Be practical, direct, and commercially aware. Prioritise cash flow, GST/TDS, receivables, pricing, scope discipline, and concrete next steps a solo operator can actually execute.',
            subscription: 'Speak like a finance lead for a SaaS business. Prioritise recurring revenue quality, churn, retention, unit economics, and forecasting.',
            services_firm: 'Speak like a commercial finance lead for an agency or services firm. Prioritise project margins, retainers, utilisation, burn, collections, and delivery risk.',
            ecommerce: 'Speak like a finance operator for a commerce business. Prioritise revenue quality, margins, working capital, inventory-linked cash flow, and collections.',
        }[businessSegment] || 'Speak like a pragmatic finance advisor for this business persona.';

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
        contextBlock += `- You do NOT have the user's private financial data unless a tool returns it. ALL user-specific numbers MUST come from tool results.\n`;
        contextBlock += `- If a tool call fails or you cannot call tools, say: "I'm unable to fetch your data right now. Please try again."\n`;
        contextBlock += `- NEVER fabricate amounts, counts, percentages, or dates. Every number you output must come from a tool response.\n\n`;
        contextBlock += `**GENERAL KNOWLEDGE POLICY:**\n`;
        contextBlock += `- You ARE allowed to answer general professional knowledge questions about GST, TDS, invoicing, bookkeeping, collections, pricing, and finance workflows without tools.\n`;
        contextBlock += `- Distinguish clearly between GENERAL GUIDANCE and USER-SPECIFIC DATA.\n`;
        contextBlock += `- For stable concept questions like "What is IGST?" or "What are GST rules in India?", answer directly in persona.\n`;
        contextBlock += `- For law, thresholds, rates, or compliance rules that may change over time, give a careful high-level answer and tell the user to verify the latest rule with a CA or the official portal if precision matters.\n`;
        contextBlock += `- NEVER say you lack general tax knowledge. Only say you lack the user's private business data when tools were not used.\n\n`;
        contextBlock += `**CAPITAEDGEX IDENTITY POLICY:**\n`;
        contextBlock += `- If the user asks who you are, who built this, what the company does, what the team believes, why ${brandProfile.name} exists, or any personal/identity question about the assistant, answer from the perspective of the **${brandProfile.teamVoice}**.\n`;
        contextBlock += `- Use first-person plural for company questions: "we", "our", "us". Do NOT answer like an individual founder unless the user names a real person and that fact is actually available in context.\n`;
        contextBlock += `- The ${brandProfile.name} mission is: "${brandProfile.mission}"\n`;
        contextBlock += `- When asked about motive or purpose, explain: "${brandProfile.purpose}"\n`;
        contextBlock += `- For brand/company answers, stay supportive, clear, and human. Do not invent biographies, team history, funding claims, office locations, or legal claims that were not provided.\n\n`;

        contextBlock += `---\n`;
        contextBlock += `## RESPONSE FORMATTING RULES (YOU MUST FOLLOW)\n\n`;
        contextBlock += `You are **Capita**, a high-end Strategic CFO AI for freelancers. Give sharp, structured, visually clear answers.\n\n`;
        contextBlock += `**PERSONA MODE:** ${personaInstructions}\n\n`;
        contextBlock += `**TONE:** Authoritative but warm. Senior advisor, not a chatbot.\n\n`;
        contextBlock += `**FORMAT RULES:**\n`;
        contextBlock += `- Start with a **1-sentence executive summary** — bold the key number or insight.\n`;
        contextBlock += `- Use \`## Heading\` for responses covering more than 2 topics.\n`;
        contextBlock += `- Use **bullet points** for any list of 3+ items. Never write lists as a comma sentence.\n`;
        contextBlock += `- **Bold** every currency amount, percentage, and key metric.\n`;
        contextBlock += `- **DEFINITION: PROFIT** - In this system, "Profit" is specifically "Total Revenue (Paid Invoices) minus Total Expenses".\n`;
        contextBlock += `- **DEFINITION: OVERDUE** - An invoice is "Overdue" ONLY if its status is 'pending' AND its dueDate is in the past.\n`;
        contextBlock += `- **DEFINITION: TOTAL INVOICES** - This includes drafts, pending invoices, and paid invoices unless explicitly stated otherwise.\n`;
        contextBlock += `- Use \`> ⚠️ ...\` for risks. Use \`> 🚀 ...\` for growth opportunities.\n`;
        contextBlock += `- End with **→ one clear next action** the user should take.\n\n`;
        contextBlock += `**NEVER DO:**\n`;
        contextBlock += `- ❌ Walls of text — max 4 sentences per paragraph.\n`;
        contextBlock += `- ❌ Comma-separated lists when there are 3+ items.\n`;
        contextBlock += `- ❌ Markdown Tables — NEVER use markdown tables (\`| ... |\`) as they are visually broken in this interface. Use tools instead.\n`;
        contextBlock += `- ❌ Filler phrases like "I can help with that" or "Great question!"\n`;
        contextBlock += `- ❌ Repeat the user's question back to them.\n\n`;
        
        contextBlock += `**CRITICAL — HIGH-FIDELITY TOOLS:**\n`;
        contextBlock += `- Use the \`get_financial_summary\` tool when the user explicitly asks for a business summary, revenue, profit, cash flow, margins, safe-to-spend, or overall metrics.\n`;
        contextBlock += `- **COUNTING CLIENTS**: If asked for client count, use the \`total_clients\` field from the financial summary tool. NEVER sum invoice counts to estimate clients.\n`;
        contextBlock += `- **ISOLATION**: You are strictly locked to data for **${businessName}**. Reassure the user you only see their data.\n`;
        contextBlock += `- If the user asks about a SPECIFIC customer, use \`get_customer_insights\` to find their ID first, then use \`get_customer_details\` to get their risk/health metrics.\n`;
        contextBlock += `- If a tool is unavailable, use clean bullet points, NOT tables.\n`;
        contextBlock += `- **UPGRADE NUDGES**: If a tool returns a \`gated: true\` response, it means the feature requires a plan upgrade. Communicate the upgrade message naturally and warmly. Include the upgrade URL (/dashboard/pricing) as a suggestion. Do NOT try to answer with fabricated data — only relay the upgrade message.\n\n`;
        if (businessSegment === 'solopreneur') {
            contextBlock += `**FREELANCER-SPECIFIC RULES:**\n`;
            contextBlock += `- Assume the user is an Indian freelancer or solo service business unless the question clearly says otherwise.\n`;
            contextBlock += `- When discussing GST, TDS, invoices, payment terms, or collections, answer from a freelancer operator's perspective.\n`;
            contextBlock += `- Prefer practical language like client, project, invoice, receivable, advance, retainer, and payout.\n`;
            contextBlock += `- Keep recommendations lightweight and execution-focused. Do not answer like an enterprise finance department.\n\n`;
        }
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
                    const prompt = `Parse this text into a strict JSON invoice.
Only include values directly present in the source text. Do not infer missing numeric values.
Source text:
${text}`;
                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const parsed = this.parseJsonText(response.text());
                    const validation = this.validateInvoiceExtractionPayload(parsed, text);

                    if (!validation.ok) {
                        throw this.buildGenericValidationError(`AI verification failed: ${validation.issues.join(', ')}`);
                    }

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
        const prompt = `You are a strict financial auditor. Audit this invoice for errors (GST/Tax errors, pricing logic, missing information, risk of rejection).
        Invoice: ${JSON.stringify(invoiceData)}
        Return a strict JSON object: { "riskScore": number (0-100), "suggestions": string[] }.
        Suggestions must stay grounded in the provided invoice data and must not invent amounts, dates, or counterparties.`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.CACHE_TTL.invoice,
            providerSuffix: 'audit',
            prompt,
            validator: (payload) => this.validateAuditPayload(payload, invoiceData),
            sanitise: (payload) => ({
                riskScore: payload.riskScore ?? 0,
                suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : ['Unable to verify audit suggestions safely.']
            })
        });
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
        const normalizedEntries = Array.isArray(historicalData)
            ? historicalData
                .map(entry => ({
                    month: entry?.month || entry?.period,
                    revenue: Number(entry?.revenue ?? entry?.total ?? 0),
                }))
                .filter(entry => entry.month)
            : Object.entries(historicalData || {}).map(([month, revenue]) => ({
                month,
                revenue: Number(revenue || 0),
            }));

        const sorted = normalizedEntries
            .filter(entry => !Number.isNaN(entry.revenue))
            .sort((a, b) => a.month.localeCompare(b.month));

        if (sorted.length === 0) {
            return [{ month: 'Forecast', revenue: 0, isForecast: true, provider: 'local_forecast' }];
        }

        const trailingWindow = sorted.slice(-3);
        const baseline = trailingWindow.reduce((sum, entry) => sum + entry.revenue, 0) / trailingWindow.length;

        let monthKey = sorted[sorted.length - 1].month;
        if (!/^\d{4}-\d{2}$/.test(monthKey)) {
            monthKey = new Date().toISOString().slice(0, 7);
        }

        const nextMonthDate = new Date(`${monthKey}-01T00:00:00Z`);
        nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
        const forecastMonth = nextMonthDate.toISOString().slice(0, 7);

        return [
            ...sorted,
            {
                month: forecastMonth,
                revenue: Math.round(baseline),
                isForecast: true,
                provider: 'local_forecast'
            }
        ];
    }

    // ═══════════════════════════════════════════════════════════
    // COLLECTION DRAFTS — with cache
    // ═══════════════════════════════════════════════════════════

    async generateCollectionDraft(invoice, currency, forceAggressive = false, userId = 'anon') {
        const cacheKey = this._cacheKey('draft', `${invoice.invoiceNumber}_${forceAggressive}`);
        const prompt = `Generate a collection email draft as strict JSON only.
Invoice context: ${JSON.stringify(invoice)}
Tone: ${forceAggressive ? 'firm' : 'professional'}.
Use only facts present in the invoice context.
Return: { "subject": string, "body": string, "discountOffered": boolean }`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.CACHE_TTL.draft,
            providerSuffix: 'draft',
            prompt,
            validator: (payload) => this.validateCollectionDraftPayload(payload, invoice),
            sanitise: (payload) => ({
                subject: payload.subject.trim(),
                body: payload.body.trim(),
                discountOffered: Boolean(payload.discountOffered)
            })
        });
    }

    async generateSettlementOffer(invoice, currency, userId = 'anon') {
        const cacheKey = this._cacheKey('draft', `settle_${invoice.invoiceNumber}`);
        const prompt = `Generate a settlement negotiation email as strict JSON only.
Invoice context: ${JSON.stringify(invoice)}
Use only invoice facts supplied here. Do not invent new amounts or deadlines.
Return: { "subject": string, "body": string, "discountOffered": boolean }`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.CACHE_TTL.draft,
            providerSuffix: 'settle',
            prompt,
            validator: (payload) => this.validateCollectionDraftPayload(payload, invoice),
            sanitise: (payload) => ({
                subject: payload.subject.trim(),
                body: payload.body.trim(),
                discountOffered: Boolean(payload.discountOffered)
            })
        });
    }

    async parseCommand(text, userId = 'anon') {
        return this.safeJsonModelCall({
            providerSuffix: 'cmd',
            prompt: `Parse this command into strict JSON only.
Supported action types: "create_customer", "unknown".
Return schema:
{ "type": "create_customer" | "unknown", "message": string, "data": { "name"?: string, "email"?: string, "phone"?: string, "address"?: string } }
If the command does not clearly map to a supported action, return type "unknown".
Command: "${text}"`,
            validator: (payload) => this.validateCommandPayload(payload),
            sanitise: (payload) => ({
                type: payload.type,
                message: typeof payload.message === 'string' ? payload.message : '',
                data: payload.data && typeof payload.data === 'object' ? payload.data : {}
            })
        });
    }

    /* ========== HELPER METHODS ========== */
}

export default new AIService();
