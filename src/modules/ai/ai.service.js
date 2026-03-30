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
        const stack = error.stack?.toLowerCase() || '';
        return (
            error.status === 429 ||
            error.statusCode === 429 ||
            msg.includes('429') ||
            msg.includes('quota exceeded') ||
            msg.includes('too many requests') ||
            msg.includes('rate limit') ||
            stack.includes('rate_limit')
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
        const lockKey = `insights_org_${context.organizationId || 'default'}`;

        // Immediate fallback if we know we are in a bad state or no model
        if (!this.model) return { data: this.fallbackGenerateInsights(context), provider: 'local_fallback' };

        return this.executeWithLock(lockKey, async () => {
            try {
                const { stats = {}, businessType = 'solopreneur' } = context;
                
                // Construct a detailed but compact prompt for better tokens
                const prompt = `You are a CFO for a ${businessType} business.
                DATA: Revenue: ${stats.total_revenue || 0}, Pending: ${stats.pending_payments || 0}.
                TASK: Return exactly 3-4 JSON insights. Format: [{ id, title, value, description, type: 'success'|'warning'|'info'|'danger' }].
                Be specific about cashflow and late payments.`;

                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                const insights = JSON.parse(response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
                
                return { 
                    data: insights, 
                    usage: response.usageMetadata, 
                    provider: 'cloud',
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                const isQuota = this.isQuotaError(error);
                
                // Staggered Retry
                if (isQuota && attempt < 2) {
                    console.warn(`📡 Insights RPM limit hit (attempt ${attempt}). Staggering 5s retry...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    return this.generateInsights(context, attempt + 1);
                }

                if (isQuota) {
                    console.warn('📡 Gemini Quota Exhausted (Insights): Generating comprehensive local metrics.');
                } else {
                    console.error('AI Insights Error:', error.message);
                }
                
                const fallbackData = this.fallbackGenerateInsights(context);
                return {
                    data: fallbackData,
                    provider: isQuota ? 'local_fallback' : 'error_fallback',
                    error: isQuota ? 'Cloud AI offline' : error.message,
                    timestamp: new Date().toISOString()
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
        const { stats = {}, safeToSpend = {}, currency = 'INR' } = context;
        const totalRev = stats.total_revenue || 0;
        const pending = stats.pending_payments || 0;
        
        let msg = `👋 **Capita Local Mode**\n\nI'm currently operating in local mode because my cloud brain is busy. Here's what I can see:\n`;
        msg += `• **Total Revenue**: ${formatCurrency(totalRev, currency)}\n`;
        if (pending > 0) msg += `• **Pending Payments**: ${formatCurrency(pending, currency)}\n`;
        if (safeToSpend?.safeToSpend) msg += `• **Safe-to-Spend**: ${formatCurrency(safeToSpend.safeToSpend, currency)}\n`;
        
        msg += `\nI can't process complex "magic" requests right now, but I'm still tracking your numbers!`;

        return { 
            text: msg,
            provider: 'local_fallback',
            timestamp: new Date().toISOString()
        };
    }

    fallbackParseInvoice(text) {
        return { buyer: { name: "", phone: "" }, items: [], provider: 'local_fallback' };
    }

    fallbackGenerateInsights(context) {
        const { stats = {}, health = {}, safeToSpend = {}, currency = 'INR', personaStats = {} } = context;
        const insights = [];

        // 1. Revenue Insight
        insights.push({
            id: 'fb-revenue',
            title: 'Revenue Snapshot',
            value: formatCurrency(stats.total_revenue || 0, currency),
            description: stats.total_revenue > 0 ? 'Consistent revenue tracking active.' : 'Start invoicing to build revenue history.',
            type: 'info'
        });

        // 2. Collections/Pending
        if (stats.pending_payments > 0) {
            const overdueCount = context.invoices?.filter(i => i.status === 'overdue').length || 0;
            insights.push({
                id: 'fb-pending',
                title: 'Receivables Status',
                value: formatCurrency(stats.pending_payments, currency),
                description: overdueCount > 0 ? `${overdueCount} invoices are currently overdue. Action recommended.` : 'Outstanding payments are within terms.',
                type: overdueCount > 0 ? 'warning' : 'info'
            });
        }

        // 3. Health Score
        if (health && health.status) {
            insights.push({
                id: 'fb-health',
                title: 'Business Health',
                value: health.status,
                description: `Score: ${health.score}/100. Based on your current payment speed and churn risk.`,
                type: health.score > 70 ? 'success' : health.score > 40 ? 'warning' : 'danger'
            });
        }

        // 4. Safe-to-Spend / Liquidity
        if (safeToSpend && safeToSpend.safeToSpend) {
            insights.push({
                id: 'fb-liquidity',
                title: 'Safe-to-Spend',
                value: formatCurrency(safeToSpend.safeToSpend, currency),
                description: 'Estimated cash available after upcoming payables.',
                type: safeToSpend.safeToSpend > 0 ? 'success' : 'warning'
            });
        }

        return insights.length > 0 ? insights : [
            { id: 'fb-empty', title: 'Data Pulse', value: 'Ready', description: 'Systems operational. Cloud AI is busy, but local analysis is active.', type: 'info' }
        ];
    }

    fallbackCollectionDraft(invoice, currency, forceAggressive = false) {
        return { subject: 'Reminder', body: 'Please pay invoice.', provider: 'local_fallback' };
    }
}

export default new AIService();
