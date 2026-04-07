/**
 * AI Query Parser Service
 * 
 * Parses and understands complex user queries:
 * - Entity extraction (invoices, customers, amounts, dates)
 * - Query classification (comparison, aggregation, explanation, action)
 * - Context understanding (follow-up, clarification)
 * - Multi-intent detection (multiple requests in one query)
 */

class AIQueryParserService {
    constructor() {
        this.entityPatterns = {
            invoiceNumber: /(?:invoice|inv|#)\s*([A-Z0-9\-]+)|([A-Z]{2,}\d{4,})/gi,
            amount: /(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:crore|lakh|thousand|k|m)?/gi,
            date: /(?:on|by|from|to|between)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
            percentage: /(\d+(?:\.\d+)?)\s*%/gi,
            customer: /(?:from|customer|client|to)\s+([A-Za-z\s]+?)(?:\s|,|$)/gi
        };

        this.queryTypes = [
            { type: 'comparison', patterns: [/compare/i, /vs\.?|versus/i, /difference between/i, /better than/i, /more than/i, /less than/i] },
            { type: 'aggregation', patterns: [/total/i, /sum/i, /average/i, /how many/i, /count/i, /sum of/i, /add up/i] },
            { type: 'explanation', patterns: [/why/i, /how come/i, /explain/i, /reason/i, /because/i, /what does/i] },
            { type: 'action', patterns: [/send/i, /create/i, /generate/i, /draft/i, /remind/i, /follow up/i, /schedule/i] },
            { type: 'prediction', patterns: [/forecast/i, /predict/i, /will/i, /expected/i, /project/i, /estimate/i] },
            { type: 'ranking', patterns: [/top/i, /best/i, /worst/i, /rank/i, /highest/i, /lowest/i, /most/i, /least/i] },
            { type: 'trend', patterns: [/trend/i, /growing/i, /declining/i, /increasing/i, /decreasing/i, /growth/i] },
            { type: 'explanation_entity', patterns: [/what is/i, /who is/i, /define/i, /meaning of/i] },
            { type: 'time_range', patterns: [/this week/i, /last month/i, /last quarter/i, /yesterday/i, /today/i, /last \d+ days/i] }
        ];

        this.actionVerbs = {
            send_reminder: [/remind/i, /follow up/i, /send reminder/i, /chase/i, /urge/i],
            create_invoice: [/create.*invoice/i, /generate invoice/i, /new invoice/i, /make invoice/i],
            send_invoice: [/send.*invoice/i, /email.*invoice/i, /share.*invoice/i],
            create_customer: [/add.*customer/i, /create.*customer/i, /new customer/i, /register.*customer/i],
            record_payment: [/record.*payment/i, /add payment/i, /log payment/i, /payment received/i],
            record_expense: [/add.*expense/i, /record.*expense/i, /log expense/i, /new expense/i],
            export_report: [/export/i, /download/i, /generate report/i, /create report/i],
            schedule_task: [/schedule/i, /remind me/i, /set reminder/i, /add to calendar/i],
            apply_discount: [/discount/i, /give.*offer/i, /reduce.*price/i, /waive/i],
            write_off: [/write off/i, /waive.*amount/i, /cancel.*invoice/i]
        };
    }

    /**
     * Main parsing method - extracts all information from query
     */
    parse(query, context = {}) {
        const normalizedQuery = String(query || '').toLowerCase();
        
        return {
            originalQuery: query,
            entities: this.extractEntities(query, context),
            queryTypes: this.detectQueryTypes(normalizedQuery),
            intents: this.detectIntents(normalizedQuery),
            actions: this.extractActions(normalizedQuery),
            timeRange: this.extractTimeRange(normalizedQuery),
            isFollowUp: this.isFollowUpQuestion(normalizedQuery, context),
            requiresComparison: this.requiresComparison(normalizedQuery),
            requiresReasoning: this.requiresReasoning(normalizedQuery),
            complexity: this.assessComplexity(normalizedQuery)
        };
    }

    /**
     * Extract entities from query
     */
    extractEntities(query, context = {}) {
        const entities = {
            invoiceNumbers: [],
            amounts: [],
            dates: [],
            percentages: [],
            customerNames: [],
            categoryNames: [],
            rawAmounts: []
        };

        // Extract invoice numbers
        const invoiceMatches = query.matchAll(/([A-Z]{2,}\d{4,})/gi);
        for (const match of invoiceMatches) {
            entities.invoiceNumbers.push(match[1]);
        }

        // Extract amounts with proper scaling
        const amountPatterns = [
            { pattern: /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*crore/gi, multiplier: 10000000 },
            { pattern: /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*lakh/gi, multiplier: 100000 },
            { pattern: /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*thousand/gi, multiplier: 1000 },
            { pattern: /(\d+(?:,\d{3})*(?:\.\d{2)?)\s*k/gi, multiplier: 1000 },
            { pattern: /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi, multiplier: 1 },
            { pattern: /rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi, multiplier: 1 }
        ];

        for (const { pattern, multiplier } of amountPatterns) {
            const matches = query.matchAll(pattern);
            for (const match of matches) {
                const value = parseFloat(match[1].replace(/,/g, ''));
                if (!isNaN(value)) {
                    entities.rawAmounts.push({ raw: match[0], value: value });
                    entities.amounts.push(value * multiplier);
                }
            }
        }

        // Extract dates
        const datePatterns = [
            { pattern: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g },
            { pattern: /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?/gi },
            { pattern: /(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi }
        ];

        for (const { pattern } of datePatterns) {
            const matches = query.matchAll(pattern);
            for (const match of matches) {
                entities.dates.push(match[0]);
            }
        }

        // Extract percentages
        const percentMatches = query.matchAll(/(\d+(?:\.\d+)?)\s*%/gi);
        for (const match of percentMatches) {
            entities.percentages.push(parseFloat(match[1]));
        }

        return entities;
    }

    /**
     * Detect query types (comparison, aggregation, etc.)
     */
    detectQueryTypes(normalizedQuery) {
        const types = [];
        
        for (const { type, patterns } of this.queryTypes) {
            if (patterns.some(pattern => pattern.test(normalizedQuery))) {
                types.push(type);
            }
        }

        return types.length > 0 ? types : ['general'];
    }

    /**
     * Detect intents from query
     */
    detectIntents(normalizedQuery) {
        const intents = [];

        // Multi-intent detection
        const multiIntentPatterns = [
            { intents: ['invoices_attention', 'payments_recent'], pattern: /(?:invoice|payment).*(?:and|also|too)/i },
            { intents: ['expenses_spend', 'business_health'], pattern: /(?:expense|spend).*(?:profit|revenue|business)/i },
            { intents: ['compliance_status', 'invoices_attention'], pattern: /(?:compliance|gst).*(?:invoice|overdue)/i }
        ];

        for (const { intents: multiIntents, pattern } of multiIntentPatterns) {
            if (pattern.test(normalizedQuery)) {
                intents.push(...multiIntents);
            }
        }

        // Single intent detection
        const intentPatterns = {
            conversational: [/^hi|^hello|^hey|^how are/i, /who are you/i, /what can you do/i],
            business_health: [/how (?:is|are) (?:the )?business/i, /business health/i, /financial health/i, /how am i doing/i],
            cash_flow: [/cash flow/i, /cash position/i, /runway/i, /liquidity/i, /safe to spend/i, /burn rate/i],
            payments_recent: [/payment/i, /received/i, /collections/i, /cash in/i, /receipt/i],
            invoices_attention: [/invoice/i, /overdue/i, /receivable/i, /collections/i, /who owes/i, /due/i],
            expenses_spend: [/expense/i, /spend/i, /cost/i, /burn/i, /vendor/i, /where.*money/i],
            compliance_status: [/compliance/i, /gst/i, /tds/i, /filing/i, /deadline/i, /due.*this/i],
            compliance_knowledge: [/gst rules/i, /tax rules/i, /what is gst/i, /explain.*tax/i],
            customer_insights: [/customer/i, /client/i, /top customer/i, /churn/i, /retention/i],
            action_request: [/open/i, /go to/i, /navigate/i, /create/i, /add/i, /send/i],
            general_advice: []
        };

        for (const [intent, patterns] of Object.entries(intentPatterns)) {
            if (patterns.some(pattern => pattern.test(normalizedQuery))) {
                if (!intents.includes(intent)) {
                    intents.push(intent);
                }
            }
        }

        return intents.length > 0 ? intents : ['general_advice'];
    }

    /**
     * Extract actionable verbs from query
     */
    extractActions(normalizedQuery) {
        const actions = [];

        for (const [action, patterns] of Object.entries(this.actionVerbs)) {
            if (patterns.some(pattern => pattern.test(normalizedQuery))) {
                actions.push(action);
            }
        }

        return actions;
    }

    /**
     * Extract time range from query
     */
    extractTimeRange(normalizedQuery) {
        const ranges = {
            'today': /today|right now|current/i,
            'yesterday': /yesterday|last day/i,
            'this_week': /this week|current week|week to date/i,
            'last_week': /last week|past week|previous week/i,
            'this_month': /this month|current month|month to date/i,
            'last_month': /last month|past month|previous month/i,
            'this_quarter': /this quarter|current quarter/i,
            'last_quarter': /last quarter|past quarter/i,
            'this_year': /this year|current year|2024|2025/i,
            'last_year': /last year|past year|previous year/i,
            'last_7_days': /last 7 days|last seven days|recent/i,
            'last_30_days': /last 30 days|last month/i,
            'last_90_days': /last 90 days|last quarter/i
        };

        for (const [range, pattern] of Object.entries(ranges)) {
            if (pattern.test(normalizedQuery)) {
                return range;
            }
        }

        return null;
    }

    /**
     * Check if this is a follow-up question
     */
    isFollowUpQuestion(normalizedQuery, context = {}) {
        const followUpIndicators = [
            /what about/i, /and what/i, /also/i, /another/i, /more/i,
            /before that/i, /earlier/i, /previously/i, /as i said/i,
            /the same/i, /continue/i, /go on/i, /keep going/i,
            /what else/i, /anything else/i, /besides/i
        ];

        if (followUpIndicators.some(pattern => pattern.test(normalizedQuery))) {
            return true;
        }

        // Check if there's previous context
        if (context?.lastQuery && context.lastQuery.length > 0) {
            const shortQuery = normalizedQuery.trim().split(/\s+/).length <= 5;
            return shortQuery;
        }

        return false;
    }

    /**
     * Check if query requires comparison
     */
    requiresComparison(normalizedQuery) {
        const comparisonIndicators = [
            /compare/i, /vs\.?|versus/i, /difference/i, /better/i, /worse/i,
            /more than/i, /less than/i, /increase.*decrease/i, /growth.*decline/i,
            /same as/i, /different from/i, /instead of/i
        ];

        return comparisonIndicators.some(pattern => pattern.test(normalizedQuery));
    }

    /**
     * Check if query requires reasoning (multi-step)
     */
    requiresReasoning(normalizedQuery) {
        const reasoningIndicators = [
            /why.*because/i, /how.*because/i, /if.*then/i,
            /should.*because/i, /would.*if/i, /what.*if/i,
            /although/i, /despite/i, /however/i, /but/i
        ];

        return reasoningIndicators.some(pattern => pattern.test(normalizedQuery));
    }

    /**
     * Assess query complexity
     */
    assessComplexity(normalizedQuery) {
        const wordCount = normalizedQuery.split(/\s+/).length;
        
        // Multiple conditions
        const hasMultipleConditions = (normalizedQuery.match(/and|but|or/gi) || []).length >= 2;
        
        // Nested questions
        const hasNestedQuestions = normalizedQuery.includes('?') && normalizedQuery.includes(' and ');
        
        // Specific data requests with filters
        const hasFilters = /between|from|to|before|after|during|while/gi.test(normalizedQuery);
        
        let complexity = 'simple';
        
        if (wordCount > 20 || hasMultipleConditions || hasNestedQuestions) {
            complexity = 'complex';
        } else if (wordCount > 10 || hasFilters || this.requiresComparison(normalizedQuery)) {
            complexity = 'moderate';
        }

        return complexity;
    }
}

export default new AIQueryParserService();