import dotenv from 'dotenv';
import { formatCurrency } from '../../../core/utils/formatting.js';
import AIBudgetService from '../infra/budget.service.js';
import AIRuntimeService from './runtime.service.js';
import AIStructuredTaskService from './structuredTask.service.js';
import circuitBreakerService from '../../../core/services/circuitBreaker.service.js';
import aiModelRouterService, { MODEL_FALLBACK_CHAIN } from '../infra/modelRouter.service.js';

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
// TIER CONFIG — Same model quality for ALL tiers.
        // Strategy: Gate by FEATURES + QUERY COUNT, not model intelligence.
        // Free users get amazing answers → converts to paid.
        // All tiers share the same ordered fallback chain so a 429 on
        // gemini-2.5-flash automatically retries on the lite/2.0 variants.
        // ═══════════════════════════════════════════════════
        this.tierModels = {
            starter:    MODEL_FALLBACK_CHAIN,
            free:       MODEL_FALLBACK_CHAIN,
            solo:       MODEL_FALLBACK_CHAIN,
            solo_pro:   MODEL_FALLBACK_CHAIN,
            enterprise: MODEL_FALLBACK_CHAIN,
        };

        // Defaults/Fallback
        this.models = MODEL_FALLBACK_CHAIN;
        this.budgetService = new AIBudgetService({
            tierModels: this.tierModels,
            fallbackModels: this.models
        });
        this.runtimeService = new AIRuntimeService({ apiKey });
        this.genAI = this.runtimeService.genAI;
        this.structuredTaskService = new AIStructuredTaskService({
            cacheKey: this._cacheKey.bind(this),
            cacheGet: this._cacheGet.bind(this),
            cacheSet: this._cacheSet.bind(this),
            cacheTtl: this.CACHE_TTL,
            models: this.models,
            hasModelClient: () => this.runtimeService.hasModelClient(),
            canMakeRequest: () => this._canMakeRequest(),
            consumeToken: () => this._consumeToken(),
            getModel: this.getModel.bind(this),
            isRetryable: this.isRetryable.bind(this),
            executeWithLock: this.executeWithLock.bind(this),
        });

        this.modelRouter = aiModelRouterService;
        this.circuitBreaker = circuitBreakerService;
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
        return this.runtimeService.canMakeRequest();
    }

    /**
     * Consume one rate limit token
     */
    _consumeToken() {
        return this.runtimeService.consumeToken();
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
        return this.budgetService.normalizeTierKey(key);
    }

    async _countMonthlyUsageRecords(orgId, firstOfMonthIso) {
        return this.budgetService.countMonthlyUsageRecords(orgId, firstOfMonthIso);
    }

    /**
     * Check if the organization has exhausted their monthly plan budget.
     * Limits are sourced from PLAN_TIERS (tierConfig.js) — single source of truth.
     */
    async _checkPlanBudget(orgId) {
        return this.budgetService.checkPlanBudget(orgId);
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
        return this.budgetService.getBudgetStatus(userId, orgId);
    }

    // ═══════════════════════════════════════════════════════════
    // CORE MODEL HELPERS & TOOL REGISTRY
    // ═══════════════════════════════════════════════════════════

    getModel(modelName, isJson = false) {
        return this.runtimeService.getModel(modelName, isJson);
    }

    parseJsonText(rawText = '') {
        return this.structuredTaskService.parseJsonText(rawText);
    }

    buildGenericValidationError(message = 'The AI response could not be verified safely.') {
        return this.structuredTaskService.buildGenericValidationError(message);
    }

    validateInvoiceExtractionPayload(payload = {}, sourceText = '') {
        return this.structuredTaskService.validateInvoiceExtractionPayload(payload, sourceText);
    }

    validateAuditPayload(payload = {}, invoiceData = {}) {
        return this.structuredTaskService.validateAuditPayload(payload, invoiceData);
    }

    validateCollectionDraftPayload(payload = {}, invoice = {}) {
        return this.structuredTaskService.validateCollectionDraftPayload(payload, invoice);
    }

    validateCommandPayload(payload = {}) {
        return this.structuredTaskService.validateCommandPayload(payload);
    }

    validateAgentPayload(payload = {}, contextData = {}) {
        return this.structuredTaskService.validateAgentPayload(payload, contextData);
    }

    async safeJsonModelCall({
        prompt,
        cacheKey = null,
        cacheTtl = null,
        validator = null,
        sanitise = null,
        providerSuffix = 'json'
    } = {}) {
        return this.structuredTaskService.safeJsonModelCall({
            prompt,
            cacheKey,
            cacheTtl,
            validator,
            sanitise,
            providerSuffix
        });
    }


    isCircuitOpen() {
        return this.runtimeService.isCircuitOpen();
    }

    openCircuit(error) {
        return this.runtimeService.openCircuit(error);
    }

    async executeWithLock(key, fn) {
        return this.runtimeService.executeWithLock(key, fn);
    }

    isRetryable(error) {
        return this.runtimeService.isRetryable(error);
    }

    // ═══════════════════════════════════════════════════════════
    // INVOICE PARSE (Magic Fill) — with cache
    // ═══════════════════════════════════════════════════════════

    async parseInvoiceText(text, userId = 'anon') {
        return this.structuredTaskService.parseInvoiceText(text, userId);
    }

    /**
     * Audit a generated invoice for risks and suggests improvements
     */
    async auditInvoice(invoiceData, userId = 'anon') {
        return this.structuredTaskService.auditInvoice(invoiceData, userId);
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
        return this.structuredTaskService.generateCollectionDraft(invoice, forceAggressive, userId);
    }

    async generateSettlementOffer(invoice, currency, userId = 'anon') {
        return this.structuredTaskService.generateSettlementOffer(invoice, userId);
    }

    async parseCommand(text, userId = 'anon') {
        return this.structuredTaskService.parseCommand(text, userId);
    }

    /* ========== HELPER METHODS ========== */
}

export default new AIService();
