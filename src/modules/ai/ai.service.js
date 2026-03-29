import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { formatCurrency, getCurrencySymbol } from '../../core/utils/formatting.js';

dotenv.config();

/**
 * AI Service using Google Gemini API
 * Provides real AI capabilities for chatbot, magic fill, insights, and predictions
 */
class AIService {
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
            this.model = null;
        } else {
            console.log('📡 Initializing Gemini AI with Performance Model: gemini-2.0-flash');
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    maxOutputTokens: 2048,
                    temperature: 0.7,
                }
            });
            this.jsonModel = this.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash-lite', // Specialized for JSON
                generationConfig: {
                    maxOutputTokens: 1000,
                    responseMimeType: "application/json"
                }
            });
        }
        this.pendingRequests = new Map(); // Key -> Promise
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
    isQuotaError(error) {
        if (!error) return false;
        const msg = error.message?.toLowerCase() || '';
        return (
            error.status === 429 ||
            error.statusCode === 429 ||
            msg.includes('429') ||
            msg.includes('quota exceeded') ||
            msg.includes('too many requests') ||
            msg.includes('rate limit')
        );
    }

    /**
     * Process chatbot query with real AI
     */
    async processQuery(query, context = {}, retry = true) {
        const actionAgents = ['agent_reminder', 'agent_settlement', 'agent_analytics', 'agent_cashflow'];
        if (context.agentId && actionAgents.includes(context.agentId)) {
            return this.processStructuredAgentQuery(query, context.agentId, context);
        }

        if (!this.model) {
            const fallback = await this.fallbackProcessQuery(query, context);
            return { ...fallback, provider: 'local_fallback' };
        }

        const lockKey = `chat_${context.user?.id || 'anon'}_${query.slice(0, 20)}`;

        return this.executeWithLock(lockKey, async () => {
            try {
                const prompt = this.buildChatbotPrompt(query, context);
                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const text = response.text();

                const action = this.extractAction(text, query);

                return {
                    text: text.trim(),
                    action,
                    data: action ? action.data : null,
                    usage: response.usageMetadata,
                    provider: 'cloud'
                };
            } catch (error) {
                const isQuota = this.isQuotaError(error);
                
                // --- EXPERIMENTAL: Staggered Retry for 429 ---
                if (isQuota && retry) {
                    console.warn('📡 Per-minute quota limit hit. Staggering 5s retry...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    return this.processQuery(query, context, false); // Retry once
                }

                if (isQuota) {
                    console.warn('📡 Gemini Quota Exhausted: Switching to Local Fallback Engine.');
                } else {
                    console.error('AI Query Error:', error.message);
                }
                
                const fallback = await this.fallbackProcessQuery(query, context);
                return {
                    ...fallback,
                    provider: isQuota ? 'local_fallback' : 'error_fallback',
                    error: isQuota ? 'Quota exceeded, using local engine.' : error.message
                };
            }
        });
    }

    /**
     * Process queries strictly enforcing structured JSON output
     */
    async processStructuredAgentQuery(query, agentId, contextData) {
        if (!this.jsonModel) {
            const fallback = await this.fallbackProcessQuery(query, contextData);
            return { ...fallback, provider: 'local_fallback' };
        }

        const { invoices = [], stats = {}, currency } = contextData;
        let systemPrompt = "";

        switch (agentId) {
            case 'agent_reminder':
                systemPrompt = `You are a strict, efficient Auto-Reminder Agent for an invoicing platform.
                CONTEXT: Overdue: ${formatCurrency(stats.pendingPayments, currency)}.
                QUERY: "${query}"`;
                break;
            case 'agent_settlement':
                systemPrompt = `You are a strict Settlement Agent. Overdue: ${JSON.stringify(invoices.filter(i => i.status === 'overdue').slice(0, 3))}. QUERY: "${query}"`;
                break;
            default:
                systemPrompt = `You are a financial AI agent. QUERY: "${query}"`;
                break;
        }

        try {
            const result = await this.jsonModel.generateContent(systemPrompt);
            const response = await result.response;
            const text = response.text();

            return {
                text: text.trim(),
                usage: response.usageMetadata,
                provider: 'cloud'
            };
        } catch (error) {
            const isQuota = this.isQuotaError(error);
            if (isQuota) {
                console.warn('📡 Gemini Quota Exhausted (JSON): Switching to Local Fallback.');
            } else {
                console.error('JSON AI Query Error:', error.message);
            }
            
            const fallback = await this.fallbackProcessQuery(query, contextData);
            return {
                ...fallback,
                provider: isQuota ? 'local_fallback' : 'error_fallback'
            };
        }
    }

    /**
     * Build system prompt with persona
     */
    buildChatbotPrompt(query, context) {
        const { stats = {}, currency = 'INR', safeToSpend, businessType = 'solopreneur' } = context;
        const curSymbol = getCurrencySymbol(currency);
        
        return `You are Capita AI CFO for ${businessType}. 
        Revenue: ${formatCurrency(stats.total_revenue, currency)}. 
        Safe-to-Spend: ${safeToSpend?.safeToSpend || 'N/A'}.
        User Query: "${query}"
        Respond concisely with numbers first.`;
    }

    /**
     * Extract action from AI response
     */
    extractAction(text, query) {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.includes('create') && lowerQuery.includes('invoice')) {
            return { type: 'open_invoice_modal', data: {} };
        }
        if (lowerQuery.includes('show') && lowerQuery.includes('invoice')) {
            return { type: 'navigate', data: { to: '/invoices' } };
        }
        return null;
    }

    /**
     * Parse invoice text (Magic Fill)
     */
    async parseInvoiceText(text) {
        if (!this.model) return { ...this.fallbackParseInvoice(text), provider: 'local_fallback' };

        try {
            const prompt = `Parse into JSON: "${text}"`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const jsonText = response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(jsonText);
            return { ...parsed, usage: response.usageMetadata, provider: 'cloud' };
        } catch (error) {
            const isQuota = this.isQuotaError(error);
            if (isQuota) {
                console.warn('📡 Gemini Quota Exhausted (Magic Fill): Using local parser.');
            } else {
                console.error('AI Parse Error:', error.message);
            }
            
            const fallback = this.fallbackParseInvoice(text);
            return {
                ...fallback,
                provider: isQuota ? 'local_fallback' : 'error_fallback'
            };
        }
    }

    /**
     * Generate business insights
     */
    async generateInsights(context, attempt = 1) {
        if (!this.model) return { data: this.fallbackGenerateInsights(context), provider: 'local_fallback' };

        const lockKey = `insights_org_${context.organizationId || 'default'}`;

        return this.executeWithLock(lockKey, async () => {
            try {
                const { stats = {} } = context;
                const prompt = `Generate JSON insights for Revenue: ${stats.total_revenue}`;
                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const insights = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                return { data: insights, usage: response.usageMetadata, provider: 'cloud' };
            } catch (error) {
                const isQuota = this.isQuotaError(error);
                if (isQuota && attempt < 2) {
                    console.warn(`📡 Insights RPM limit hit (attempt ${attempt}). Staggering 5s retry...`);
                    await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
                    return this.generateInsights(context, attempt + 1);
                }

                if (isQuota) {
                    console.warn('📡 Gemini Quota Exhausted (Insights): Generating cached/static insights.');
                } else {
                    console.error('AI Insights Error:', error.message);
                }
                
                const fallbackData = this.fallbackGenerateInsights(context);
                return {
                    data: fallbackData,
                    provider: isQuota ? 'local_fallback' : 'error_fallback'
                };
            }
        });
    }

    predictRevenue(historicalData) {
        return [{ month: 'Forecast', revenue: 0, isForecast: true, provider: 'local_fallback' }];
    }

    async generateCollectionDraft(invoice, currency, forceAggressive = false) {
        if (!this.model) return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: 'local_fallback' };

        try {
            const prompt = `Generate collection draft for Invoice #${invoice.invoiceNumber}`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            return { ...parsed, usage: response.usageMetadata, provider: 'cloud' };
        } catch (error) {
            console.error('AI Collection Draft Error:', error.message);
            const isQuota = this.isQuotaError(error);
            return { ...this.fallbackCollectionDraft(invoice, currency, forceAggressive), provider: isQuota ? 'local_fallback' : 'error_fallback' };
        }
    }

    async generateSettlementOffer(invoice, currency) {
        if (!this.model) return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback' };
        try {
            const prompt = `Generate settlement for Invoice #${invoice.invoiceNumber}`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            return { ...parsed, usage: response.usageMetadata, provider: 'cloud' };
        } catch (error) {
            return { subject: 'Offer', body: 'Please pay', provider: 'local_fallback' };
        }
    }

    async parseCommand(text) {
        if (!this.model) return { type: 'LIST_OVERDUE', provider: 'local_fallback' };
        try {
            const prompt = `Parse command: "${text}"`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const parsed = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            return { ...parsed, usage: response.usageMetadata, provider: 'cloud' };
        } catch (error) {
            return { type: 'LIST_OVERDUE', provider: 'local_fallback' };
        }
    }

    /* ========== Fallback Methods ========== */

    fallbackProcessQuery(query, context) {
        const stats = context.stats || {};
        const totalRev = stats.total_revenue || 0;
        return { 
            text: `👋 Capita Local Mode. Revenue: ${formatCurrency(totalRev, context.currency)}. Cloud AI busy.`,
            provider: 'local_fallback'
        };
    }

    fallbackParseInvoice(text) {
        return { buyer: { name: "", phone: "" }, items: [], provider: 'local_fallback' };
    }

    fallbackGenerateInsights(context) {
        const stats = context.stats || {};
        return [{ id: 'fb-1', title: 'Revenue', value: formatCurrency(stats.total_revenue, context.currency), description: 'Cloud AI offline.', type: 'info' }];
    }

    fallbackCollectionDraft(invoice, currency, forceAggressive = false) {
        return { subject: 'Reminder', body: 'Please pay invoice.', provider: 'local_fallback' };
    }
}

export default new AIService();
