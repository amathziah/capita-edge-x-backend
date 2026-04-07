import dotenv from 'dotenv';
import { formatCurrency } from '../../core/utils/formatting.js';
import { supabase } from '../../core/database/supabase.js';
import analyticsService from '../analytics/analytics.service.js';
import aiReadModelService from './aiReadModel.service.js';
import aiToolRegistryService from './aiToolRegistry.service.js';
import AIBudgetService from './aiBudget.service.js';
import AIGroundingService from './aiGrounding.service.js';
import AIRuntimeService from './aiRuntime.service.js';
import AIStructuredTaskService from './aiStructuredTask.service.js';

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
        this.budgetService = new AIBudgetService({
            tierModels: this.tierModels,
            fallbackModels: this.models
        });
        this.groundingService = new AIGroundingService();
        this.runtimeService = new AIRuntimeService({
            apiKey
        });
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
            collectExecutionEvidence: this.collectExecutionEvidence.bind(this),
            extractClaimNumbers: this._extractClaimNumbers.bind(this)
        });

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

    buildEvidencePrompt(query, context = {}, execution = {}) {
        return this.groundingService.buildEvidencePrompt(query, context, execution);
    }

    buildGroundedJsonPrompt(query, context = {}, execution = {}) {
        return this.groundingService.buildGroundedJsonPrompt(query, context, execution);
    }

    _normaliseClaimNumber(value) {
        return this.groundingService._normaliseClaimNumber(value);
    }

    _extractClaimNumbers(text = '') {
        return this.groundingService._extractClaimNumbers(text);
    }

    _collectEvidenceFacts(value, accumulator = { numbers: new Set() }) {
        return this.groundingService._collectEvidenceFacts(value, accumulator);
    }

    collectExecutionEvidence(execution = {}) {
        return this.groundingService.collectExecutionEvidence(execution);
    }

    validateGroundedPayload(payload = {}, execution = {}, queryRisk = {}) {
        return this.groundingService.validateGroundedPayload(payload, execution, queryRisk);
    }

    formatGroundedPayload(payload = {}) {
        return this.groundingService.formatGroundedPayload(payload);
    }

    buildToolBackedFallbackAnswer(query = '', execution = {}) {
        return this.groundingService.buildToolBackedFallbackAnswer(query, execution);
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

    async generateExecutionPlan(query, context = {}) {
        const tools = aiToolRegistryService.getAllToolDeclarations();
        
        const systemPrompt = `You are the primary intelligence router for Capita, an AI finance advisor.
Analyze the user's query and decide:
1. The primary intent of the user.
2. The specific tools needed to fetch data to answer the query.

Available Tools:
${JSON.stringify(tools, null, 2)}

Intent Categories:
- conversational: greetings, "what can you do?", or pure small-talk
- business_health: broad queries like "how is my business", "what should I focus on"
- cash_flow: "safe to spend", "cash runway", "liquidity"
- payments_recent: queries specifically about recent collections or received payments
- invoices_attention: queries about overdue invoices, who owes money, collections
- expenses_spend: queries about spend, expenses, vendor costs, where money is going
- compliance_status: queries about upcoming deadlines, pending tax filings, GST/TDS status
- compliance_knowledge: queries about tax rules, HR policies, general compliance (not specific workspace status)
- customer_insights: "who is my top customer", "biggest client"
- action_request: PURE NAVIGATION ONLY. e.g. "open invoices", "go to dashboard", "create a customer". NEVER use this if the user asks a data question (e.g. "show me my overdue invoices" should be invoices_attention).
- general_advice: open-ended non-data queries that do not match above.

Output a valid JSON object matching the exact schema below:
{
    "intent": "category_name",
    "toolsToRun": [{"toolId": "tool_name", "args": {}}]
}

If no tools are needed (e.g. pure conversational or pure navigation action_request), return an empty array for toolsToRun.`;

        const requestText = `User Query: "${query}"`;
        
        try {
            const rawOutput = await this.safeJsonModelCall({
                prompt: `${systemPrompt}\n\n${requestText}`,
                providerSuffix: 'json',
                validator: (data) => {
                    const intent = data?.intent;
                    if (!intent || typeof intent !== 'string') {
                        return { ok: false, issues: ['Missing intent'] };
                    }
                    return { ok: true, issues: [] };
                }
            });

            return {
                intent: rawOutput.intent || 'general_advice',
                tools: (rawOutput.toolsToRun || []).map(t => ({
                    toolId: t.toolId || t,
                    args: t.args || {}
                }))
            };
        } catch (err) {
            console.error('Failed to generate execution plan from Gemini:', err);
            // Graceful fallback to general and no tools
            return { intent: 'general_advice', tools: [] };
        }
    }

    analyzeQueryRisk(query, execution = {}) {
        const risk = this.groundingService.analyzeQueryRisk(query, execution);
        risk.intent = execution.intent || null;
        return risk;
    }

    buildConversationalAnswer(queryRisk = {}, query = '') {
        const lowerQuery = String(query || '').toLowerCase();
        if (lowerQuery.includes('what can you do') || lowerQuery.includes('things you can do') || lowerQuery.includes('help')) {
            return [
                'I can help you across three finance desks first: invoices, payments, and expenses.',
                '',
                '- Invoices: overdue counts, collections priority, receivables exposure, and invoice health',
                '- Payments: recent receipts, payment timing, reconciliation, and cash-in visibility',
                '- Expenses: spend breakdown, burn pressure, category review, and cost-control suggestions',
                '- I can also pull business health, cash flow, and compliance context when needed',
                '',
                'Try asking: “Which invoices need attention?”, “What payments came in recently?”, or “What are we spending on this month?”'
            ].join('\n');
        }

        if (lowerQuery.includes('hi') || lowerQuery.includes('hello') || lowerQuery.includes('hey') || lowerQuery.includes('how are you')) {
            return 'Hello. Start with invoices, payments, or expenses and I will answer from your live workspace data.';
        }

        return this.buildUnverifiedAnswer(queryRisk, []);
    }

    buildSafetyMetadata(execution = {}, queryRisk = {}) {
        return this.groundingService.buildSafetyMetadata(execution, queryRisk);
    }

    buildUnsupportedAnswer(queryRisk = {}) {
        return this.groundingService.buildUnsupportedAnswer(queryRisk);
    }

    buildUnverifiedAnswer(queryRisk = {}, issues = []) {
        return this.groundingService.buildUnverifiedAnswer(queryRisk, issues);
    }

    _sanitizeAssistantText(text = '') {
        const normalized = String(text ?? '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .filter((line) => {
                const trimmed = line.trim();
                return trimmed !== '0' && trimmed !== '';
            })
            .join('\n')
            .trim();

        return normalized;
    }

    async generateGroundedAnswer(query, context = {}, execution = {}) {
        const userId = context.user?.id || 'anon';
        const orgId = context.organizationId;
        const budget = await this._checkPlanBudget(orgId);
        const queryRisk = this.analyzeQueryRisk(query, execution);

        if ((execution.intent === 'conversational' || queryRisk.isConversationalSafe) && !queryRisk.hasToolEvidence) {
            const answer = this.buildConversationalAnswer(queryRisk, query);
            return {
                text: this._sanitizeAssistantText(answer),
                action: null,
                data: this.buildSafetyMetadata(execution, queryRisk),
                usage: null,
                provider: 'system:conversational',
                budget: await this.getBudgetStatus(userId, orgId)
            };
        }

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
                            text: this._sanitizeAssistantText(fallbackText),
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
                        text: this._sanitizeAssistantText(this.formatGroundedPayload(payload)),
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
                    text: this._sanitizeAssistantText(rawText),
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

        if (lastError && this.isRetryable(lastError)) {
            return {
                text: this._sanitizeAssistantText(execution.toolResults?.length
                    ? this.buildToolBackedFallbackAnswer(query, execution)
                    : 'I’m temporarily unable to reach the AI model. Try again in a moment or ask a narrower grounded question.'),
                action: null,
                data: this.buildSafetyMetadata(execution, queryRisk),
                usage: null,
                provider: 'system:model_fallback',
                budget: await this.getBudgetStatus(userId, orgId)
            };
        }

        throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
    }

    async *generateGroundedAnswerStream(query, context = {}, execution = {}) {
        const userId = context.user?.id || 'anon';
        const orgId = context.organizationId;
        const budget = await this._checkPlanBudget(orgId);
        const queryRisk = this.analyzeQueryRisk(query, execution);

        if ((execution.intent === 'conversational' || queryRisk.isConversationalSafe) && !queryRisk.hasToolEvidence) {
            yield {
                type: 'complete',
                text: this._sanitizeAssistantText(this.buildConversationalAnswer(queryRisk, query)),
                action: null,
                usage: null,
                provider: 'system:conversational',
                budget: await this.getBudgetStatus(userId, orgId),
                data: this.buildSafetyMetadata(execution, queryRisk)
            };
            return;
        }

        if (queryRisk.shouldRefuseGeneralAnswer) {
            yield {
                type: 'complete',
                text: this._sanitizeAssistantText(this.buildUnsupportedAnswer(queryRisk)),
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
                        text: this._sanitizeAssistantText(fallbackText),
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
                        text: this._sanitizeAssistantText(this.formatGroundedPayload(payload)),
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
                    text: this._sanitizeAssistantText(rawText),
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

        if (lastError && this.isRetryable(lastError)) {
            yield {
                type: 'complete',
                text: this._sanitizeAssistantText(execution.toolResults?.length
                    ? this.buildToolBackedFallbackAnswer(query, execution)
                    : 'I’m temporarily unable to reach the AI model. Try again in a moment or ask a narrower grounded question.'),
                action: null,
                usage: null,
                provider: 'system:model_fallback',
                budget: await this.getBudgetStatus(userId, orgId),
                data: this.buildSafetyMetadata(execution, queryRisk)
            };
            return;
        }

        throw lastError || new Error('Cloud Busy: All AI models failed. Please try again.');
    }

    /**
     * Sanitise a Gemini history array:
     * - Filter out entries with empty text
     * - Drop leading 'model' turns (Gemini requires history to start with 'user')
     */
    _sanitiseHistory(history = []) {
        return this.runtimeService.sanitiseHistory(history);
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
