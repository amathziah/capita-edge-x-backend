import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { formatCurrency, getCurrencySymbol } from '../../core/utils/formatting.js';

dotenv.config();

/**
 * AI Service using Google Gemini API
 * Provides real AI capabilities for chatbot, magic fill, insights, and predictions
 * Features: Multi-model fallback, Circuit Breaker, Request Deduplication
 */
class AIService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        this.apiKey = apiKey;
        this.pendingRequests = new Map();
        this.circuitStatus = { open: false, until: 0 };

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
        } else {
            this.genAI = new GoogleGenerativeAI(apiKey);
            // 2026 Modern Model Chain (Priority Order)
            this.models = [
                'gemini-3.1-flash-preview',
                'gemini-3-flash-preview',
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-2.5-pro'
            ];
            console.log('📡 AI Service Initialized with Gemini 3+ Multi-Model Fallback.');
        }
    }

    /**
     * Internal helper to get a specific model instance
     */
    getModel(modelName, isJson = false) {
        if (!this.genAI) return null;
        return this.genAI.getGenerativeModel({
            model: modelName,
            generationConfig: isJson ? {
                maxOutputTokens: 1000,
                responseMimeType: "application/json"
            } : {
                maxOutputTokens: 2048,
                temperature: 0.7,
            }
        });
    }

    /**
     * Helper to check if the Gemini circuit is currently "Open" (Down)
     */
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

    /**
     * Helper to open (trip) the circuit when a quota limit is hit
     */
    openCircuit(error) {
        const cooldown = 45000; // 45 seconds initial cooldown
        this.circuitStatus = { open: true, until: Date.now() + cooldown };
        console.warn(`📡 Gemini Circuit Opened: Cloud AI busy. Defaulting to Local Mode for ${cooldown/1000}s.`);
    }

    /**
     * Deduplicates parallel requests for the same resource
     */
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

    /**
     * Helper to detect quota/rate-limit errors
     */
    isRetryable(error) {
        if (!error) return false;
        const msg = error.message?.toLowerCase() || '';
        const status = error.status || error.statusCode || 0;
        
        // 429: Quota, 503: Overloaded
        const isTransient = (
            status === 429 ||
            status === 503 ||
            msg.includes('429') ||
            msg.includes('quota') ||
            msg.includes('overloaded') ||
            msg.includes('rate limit')
        );

        // 404: Model Not Found (skip it in the chain)
        const isConfigError = (
            status === 404 ||
            msg.includes('not found') ||
            msg.includes('not supported')
        );

        return isTransient || isConfigError;
    }

    /**
     * Process chatbot query with real AI
     */
    async processQuery(query, context = {}, retry = true) {
        const actionAgents = ['agent_reminder', 'agent_settlement', 'agent_analytics', 'agent_cashflow'];
        if (context.agentId && actionAgents.includes(context.agentId)) {
            return this.processStructuredAgentQuery(query, context.agentId, context);
        }

        if (!this.genAI || this.isCircuitOpen()) {
            return {
                ...(await this.fallbackProcessQuery(query, context)),
                provider: 'local_fallback',
                is_cooldown: this.isCircuitOpen()
            };
        }

        const lockKey = `chat_${context.user?.id || 'anon'}_${query.slice(0, 20)}`;

        return this.executeWithLock(lockKey, async () => {
            let lastError = null;
            
            for (const modelName of this.models) {
                try {
                    const modelInstance = this.getModel(modelName);
                    if (!modelInstance) continue;

                    const prompt = this.buildChatbotPrompt(query, context);
                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const text = response.text();

                    const action = this.extractAction(text, query);

                    return {
                        text: text.trim(),
                        action,
                        data: action ? action.data : null,
                        usage: response.usageMetadata,
                        provider: `cloud:${modelName}`
                    };
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
                error: lastError?.message || 'AI service unavailable'
            };
        });
    }

    /**
     * Process queries strictly enforcing structured JSON output
     */
    async processStructuredAgentQuery(query, agentId, contextData) {
        if (!this.genAI) {
            const fallback = await this.fallbackProcessQuery(query, contextData);
            return { ...fallback, provider: 'local_fallback' };
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
                const modelInstance = this.getModel(modelName, true);
                if (!modelInstance) continue;

                const result = await modelInstance.generateContent(systemPrompt);
                const response = await result.response;
                return {
                    text: response.text().trim(),
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:json`
                };
            } catch (error) {
                lastError = error;
                if (this.isRetryable(error)) continue;
                break;
            }
        }

        return { ...(await this.fallbackProcessQuery(query, contextData)), provider: 'local_fallback' };
    }

    /**
     * Build system prompt with persona
     */
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
        
        User Query: "${query}"`;
    }

    /**
     * Extract action from AI response
     */
    extractAction(text, query) {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.includes('create') && lowerQuery.includes('invoice')) return { type: 'open_invoice_modal', data: {} };
        if (lowerQuery.includes('show') && lowerQuery.includes('invoice')) return { type: 'navigate', data: { to: '/invoices' } };
        return null;
    }

    /**
     * Parse invoice text (Magic Fill)
     */
    async parseInvoiceText(text) {
        if (!this.genAI) return { ...this.fallbackParseInvoice(text), provider: 'local_fallback' };

        for (const modelName of this.models) {
            try {
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Parse this text into a strict JSON invoice: "${text}"`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const parsed = JSON.parse(jsonText);
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:magic` };
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { ...this.fallbackParseInvoice(text), provider: 'local_fallback' };
    }

    /**
     * Generate business insights
     */
    async generateInsights(context) {
        const lockKey = `insights_org_${context.organizationId || 'default'}`;

        if (!this.genAI || this.isCircuitOpen()) {
            return { 
                data: this.fallbackGenerateInsights(context), 
                provider: 'local_fallback',
                is_cooldown: this.isCircuitOpen()
            };
        }

        return this.executeWithLock(lockKey, async () => {
            let lastError = null;

            for (const modelName of this.models) {
                try {
                    const modelInstance = this.getModel(modelName, true);
                    if (!modelInstance) continue;

                    const { stats = {}, businessType = 'solopreneur' } = context;
                    const prompt = `You are a CFO for a ${businessType} business.
                    DATA: Revenue: ${stats.total_revenue || 0}, Pending: ${stats.pending_payments || 0}.
                    TASK: Return exactly 3-4 JSON insights. Format: [{ id, title, value, description, type: 'success'|'warning'|'info'|'danger' }].`;

                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const cleanJson = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                    const insights = JSON.parse(cleanJson);
                    
                    return { 
                        data: insights, 
                        usage: response.usageMetadata, 
                        provider: `cloud:${modelName}:insights`,
                        timestamp: new Date().toISOString()
                    };
                } catch (error) {
                    lastError = error;
                    if (this.isRetryable(error)) continue;
                    break;
                }
            }

            const isRetryable = this.isRetryable(lastError);
            if (isRetryable && (lastError?.status === 429 || lastError?.statusCode === 429)) {
                this.openCircuit(lastError);
            }
            return { data: this.fallbackGenerateInsights(context), provider: isRetryable ? 'local_fallback' : 'error_fallback' };
        });
    }

    predictRevenue(historicalData) {
        return [{ month: 'Forecast', revenue: 0, isForecast: true, provider: 'local_fallback' }];
    }

    async generateCollectionDraft(invoice, currency, forceAggressive = false) {
        if (!this.genAI) return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: 'local_fallback' };

        for (const modelName of this.models) {
            try {
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate collection draft for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:draft` };
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: 'local_fallback' };
    }

    async generateSettlementOffer(invoice, currency) {
        if (!this.genAI) return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback' };
        
        for (const modelName of this.models) {
            try {
                const modelInstance = this.getModel(modelName, true);
                const prompt = `Generate settlement for Invoice #${invoice.invoiceNumber}`;
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                return { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:settle` };
            } catch (error) {
                if (this.isRetryable(error)) continue;
                break;
            }
        }
        return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback' };
    }

    async parseCommand(text) {
        if (!this.genAI) return { type: 'LIST_OVERDUE', provider: 'local_fallback' };
        
        for (const modelName of this.models) {
            try {
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
        return { type: 'LIST_OVERDUE', provider: 'local_fallback' };
    }

    /* ========== Fallback Methods ========== */

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
