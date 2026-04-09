/**
 * Enhanced AI Intent Service
 * 
 * Advanced intent detection with:
 * - Semantic understanding
 * - Context awareness
 * - Multi-intent support
 * - Confidence scoring
 * - Fuzzy matching
 */

import aiQueryParserService from './queryParser.service.js';

class AIEnhancedIntentService {
    constructor() {
        this.confidenceThreshold = 0.7;
        
        this.intentPatterns = {
            conversational: {
                weight: 1.0,
                patterns: [
                    /^hi$|^hello$|^hey$/i,
                    /who are you/i,
                    /what can you do/i,
                    /how are you/i,
                    /good (morning|evening|afternoon|night)/i,
                    /thank(s| you)/i,
                    /help/i,
                    /what are the things you can do/i,
                    /capabilities/i
                ],
                requiredConfidence: 0.8
            },
            business_health: {
                weight: 0.9,
                patterns: [
                    /how (?:is|are) (?:the )?(?:business|company|finances)/i,
                    /business health/i,
                    /financial health/i,
                    /how am i doing/i,
                    /how are we doing/i,
                    /overall picture/i,
                    /full picture/i,
                    /summary/i,
                    /performance/i,
                    /how.*business.*performing/i,
                    /company.*status/i
                ],
                contextKeywords: ['business', 'company', 'overall', 'performance', 'health']
            },
            cash_flow: {
                weight: 0.95,
                patterns: [
                    /cash flow/i,
                    /cash position/i,
                    /cash/i,
                    /runway/i,
                    /liquidity/i,
                    /safe to spend/i,
                    /burn rate/i,
                    /cash on hand/i,
                    /working capital/i,
                    /bank balance/i,
                    /available cash/i
                ]
            },
            payments_recent: {
                weight: 0.95,
                patterns: [
                    /payment/i,
                    /payments/i,
                    /received/i,
                    /collections/i,
                    /cash in/i,
                    /receipt/i,
                    /receipts/i,
                    /money in/i,
                    /income/i,
                    /revenue collected/i,
                    /settlements/i,
                    /paid.*me/i,
                    /got paid/i,
                    /came in/i
                ]
            },
            invoices_attention: {
                weight: 0.95,
                patterns: [
                    /invoice/i,
                    /invoices/i,
                    /overdue/i,
                    /overdue.*invoice/i,
                    /receivable/i,
                    /receivables/i,
                    /collections/i,
                    /who owes/i,
                    /due/i,
                    /pending.*invoice/i,
                    /unpaid/i,
                    /outstanding/i,
                    /aging/i,
                    /debtor/i,
                    /send reminder/i,
                    /chase/i,
                    /follow up.*invoice/i
                ]
            },
            expenses_spend: {
                weight: 0.95,
                patterns: [
                    /expense/i,
                    /expenses/i,
                    /spend/i,
                    /spending/i,
                    /cost/i,
                    /costs/i,
                    /burn/i,
                    /vendor/i,
                    /vendor.*bill/i,
                    /where.*money/i,
                    /where.*spent/i,
                    /how much.*spent/i,
                    /operating cost/i,
                    /monthly spend/i,
                    /category.*spend/i
                ]
            },
            compliance_status: {
                weight: 0.9,
                patterns: [
                    /compliance/i,
                    /gst/i,
                    /tds/i,
                    /filing/i,
                    /deadline/i,
                    /due this/i,
                    /upcoming/i,
                    /tax.*return/i,
                    /form.*filing/i,
                    /return filed/i,
                    /pending.*task/i,
                    /overdue.*task/i,
                    /gst return/i,
                    /tds.*certificate/i
                ]
            },
            compliance_knowledge: {
                weight: 0.85,
                patterns: [
                    /gst rules/i,
                    /tax rules/i,
                    /what is gst/i,
                    /explain.*tax/i,
                    /gst.*how/i,
                    /tds.*rules/i,
                    /section.*tax/i,
                    /tax.*rate/i,
                    /gst.*rate/i,
                    /invoice.*rules/i,
                    /legal/i,
                    /regulation/i,
                    /what.*allowed/i,
                    /what.*required/i
                ]
            },
            customer_insights: {
                weight: 0.9,
                patterns: [
                    /customer/i,
                    /customers/i,
                    /client/i,
                    /clients/i,
                    /top customer/i,
                    /biggest client/i,
                    /churn/i,
                    /retention/i,
                    /customer.*health/i,
                    /at risk/i,
                    /revenue.*customer/i,
                    /customer.*value/i,
                    /portfolio/i,
                    /customer.*analytics/i
                ]
            },
            comparison: {
                weight: 0.8,
                patterns: [
                    /compare/i,
                    /vs\.?|versus/i,
                    /difference between/i,
                    /better than/i,
                    /worse than/i,
                    /more than/i,
                    /less than/i,
                    /increase.*decrease/i,
                    /growth.*decline/i
                ]
            },
            trend: {
                weight: 0.8,
                patterns: [
                    /trend/i,
                    /growing/i,
                    /declining/i,
                    /increasing/i,
                    /decreasing/i,
                    /growth/i,
                    /month.*over.*month/i,
                    /year.*over.*year/i,
                    / QoQ /i,
                    / YoY /i,
                    /analysis/i,
                    /change over/i
                ]
            },
            action_request: {
                weight: 0.9,
                patterns: [
                    /\bopen\s+(?:the\s+)?(invoice|payment|expense|compliance|dashboard|settings| customers?)\b/i,
                    /\bgo\s+to\s+(?:the\s+)?(invoice|payment|expense|compliance|dashboard|settings)\b/i,
                    /\bnavigate\s+to\s+(?:the\s+)?(invoice|payment|expense|compliance|dashboard)\b/i,
                    /\bcreate\s+(?:a\s+)?(?:new\s+)?(invoice|customer|expense|payment)\b/i,
                    /\bsend\s+(?:an?\s+)?invoice\b/i,
                    /\badd\s+(?:a\s+)?(?:new\s+)?(customer|expense|payment)\b/i,
                    /\bshow\s+(?:me\s+)?(?:the\s+)?workspaces?\b/i,
                    /generate.*report/i,
                    /export.*data/i,
                    /download.*report/i
                ]
            },
            general_advice: {
                weight: 0.5,
                patterns: [
                    /what.*(should|i can|can i)/i,
                    /advise/i,
                    /suggest/i,
                    /recommend/i,
                    /best.*practice/i,
                    /tips/i,
                    /ideas/i
                ]
            },
            spending_decision: {
                weight: 0.92,
                patterns: [
                    /can i afford/i,
                    /should i (spend|buy|invest|hire|pay for)/i,
                    /is it (safe|okay|ok) to spend/i,
                    /do i have enough/i,
                    /can i pay for/i,
                    /is this a good time to (spend|invest|buy)/i,
                    /afford to hire/i,
                    /afford to pay/i,
                    /how much can i spend/i,
                    /how much can we spend/i,
                    /budget for/i,
                    /should i take on/i,
                    /should we invest/i
                ]
            },
            profitability: {
                weight: 0.88,
                patterns: [
                    /am i profitable/i,
                    /are we profitable/i,
                    /is the business profitable/i,
                    /making money/i,
                    /losing money/i,
                    /profit.*this (month|year|quarter)/i,
                    /net profit/i,
                    /profit margin/i,
                    /how much.*made/i,
                    /how much.*earned/i,
                    /revenue vs expense/i,
                    /income vs cost/i
                ]
            }
        };

        this.domainMapping = {
            conversational: 'general',
            business_health: 'finance',
            cash_flow: 'finance',
            payments_recent: 'payments',
            invoices_attention: 'invoices',
            expenses_spend: 'expenses',
            compliance_status: 'compliance',
            compliance_knowledge: 'compliance',
            customer_insights: 'customers',
            comparison: 'finance',
            trend: 'finance',
            action_request: 'actions',
            general_advice: 'finance',
            spending_decision: 'finance',
            profitability: 'finance'
        };

        this.specialistMapping = {
            conversational: 'Capita CFO',
            business_health: 'CFO — Business Health',
            cash_flow: 'CFO — Liquidity Desk',
            payments_recent: 'CFO — Collections Desk',
            invoices_attention: 'CFO — Receivables Desk',
            expenses_spend: 'CFO — Spend Desk',
            compliance_status: 'CFO — Compliance Desk',
            compliance_knowledge: 'CFO — Compliance Desk',
            customer_insights: 'CFO — Customer Portfolio',
            comparison: 'CFO — Analytics Desk',
            trend: 'CFO — Analytics Desk',
            action_request: 'CFO — Operations',
            general_advice: 'Capita CFO',
            spending_decision: 'CFO — Cash Desk',
            profitability: 'CFO — P&L Desk'
        };

        this.confidenceModifiers = {
            exactMatch: 1.0,
            startsWith: 0.9,
            contains: 0.7,
            fuzzy: 0.5
        };
    }

    /**
     * Enhanced intent detection with confidence scoring
     */
    detectWithConfidence(query, context = {}) {
        const parsed = aiQueryParserService.parse(query, context);
        const normalizedQuery = String(query || '').toLowerCase();

        const results = [];
        
        // Check each intent pattern
        for (const [intent, config] of Object.entries(this.intentPatterns)) {
            const matchResult = this.matchIntent(normalizedQuery, config.patterns, intent);
            
            if (matchResult.score > 0) {
                // Apply complexity modifier
                let complexityModifier = 1.0;
                if (parsed.complexity === 'complex') {
                    complexityModifier = 1.1; // Boost confidence for complex queries
                } else if (parsed.complexity === 'simple') {
                    complexityModifier = 0.9;
                }

                // Apply follow-up modifier
                if (parsed.isFollowUp && context?.lastIntent) {
                    if (intent === context.lastIntent) {
                        // High confidence for follow-up on same topic
                        results.push({
                            intent,
                            score: Math.min(1, matchResult.score * 1.2),
                            method: matchResult.method,
                            isFollowUp: true,
                            previousIntent: context.lastIntent
                        });
                        continue;
                    }
                }

                results.push({
                    intent,
                    score: Math.min(1, matchResult.score * complexityModifier),
                    method: matchResult.method,
                    isFollowUp: false
                });
            }
        }

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);

        // Multi-intent handling
        const multiIntentResult = this.handleMultiIntent(results, parsed);

        return {
            primaryIntent: multiIntentResult.primaryIntent,
            secondaryIntents: multiIntentResult.secondaryIntents,
            allIntents: results,
            confidence: results[0]?.score || 0,
            domain: this.domainMapping[results[0]?.intent] || 'finance',
            specialistLabel: this.specialistMapping[results[0]?.intent] || 'Finance Guide',
            requiresComparison: parsed.requiresComparison,
            requiresReasoning: parsed.requiresReasoning,
            complexity: parsed.complexity,
            isConversational: results[0]?.intent === 'conversational',
            queryTypes: parsed.queryTypes,
            parsedEntities: parsed.entities,
            timeRange: parsed.timeRange,
            suggestedActions: parsed.actions
        };
    }

    /**
     * Match intent with scoring
     */
    matchIntent(query, patterns, intent) {
        let bestScore = 0;
        let bestMethod = 'none';

        for (const pattern of patterns) {
            if (pattern.test(query)) {
                // Check match type
                if (pattern.source.startsWith('^')) {
                    return { score: 1.0, method: 'exactMatch' };
                }
                
                const score = this.confidenceModifiers.contains;
                if (score > bestScore) {
                    bestScore = score;
                    bestMethod = 'contains';
                }
            }
        }

        // Fuzzy matching if no direct match
        if (bestScore === 0) {
            const fuzzyResult = this.fuzzyMatch(query, patterns);
            if (fuzzyResult.score > 0.3) {
                return fuzzyResult;
            }
        }

        return { score: bestScore, method: bestMethod };
    }

    /**
     * Fuzzy matching for close queries
     */
    fuzzyMatch(query, patterns) {
        const queryWords = new Set(query.split(/\s+/).filter(w => w.length > 3));
        
        for (const pattern of patterns) {
            const patternStr = pattern.source;
            const patternWords = new Set(patternStr.split(/\s+/).filter(w => w.length > 3 && !/^(?:i|me|my|we|our)$/i.test(w)));
            
            // Calculate Jaccard similarity
            const intersection = new Set([...queryWords].filter(x => patternWords.has(x.toLowerCase())));
            const union = new Set([...queryWords, ...patternWords]);
            
            const similarity = intersection.size / union.size;
            
            if (similarity > 0.3) {
                return {
                    score: similarity * this.confidenceModifiers.fuzzy,
                    method: 'fuzzy'
                };
            }
        }

        return { score: 0, method: 'none' };
    }

    /**
     * Handle multi-intent queries
     */
    handleMultiIntent(intents, parsed) {
        const topIntents = intents.slice(0, 3);
        const primaryIntent = topIntents[0]?.intent || 'general_advice';
        
        let secondaryIntents = [];
        
        // Check for multi-intent indicators in query
        if (parsed.queryTypes.includes('comparison') || parsed.queryTypes.includes('aggregation')) {
            // Find related intents
            const relatedIntents = this.findRelatedIntents(primaryIntent);
            secondaryIntents = topIntents
                .filter(i => relatedIntents.includes(i.intent))
                .slice(0, 2)
                .map(i => i.intent);
        }

        // If query has clear multi-intent markers
        if (/\band\b|\balso\b|\bbesides\b|\bin addition\b/i.test(parsed.originalQuery)) {
            secondaryIntents = topIntents
                .slice(1, 3)
                .filter(i => i.score > 0.4)
                .map(i => i.intent);
        }

        return {
            primaryIntent,
            secondaryIntents: [...new Set(secondaryIntents)]
        };
    }

    /**
     * Find related intents for multi-intent queries
     */
    findRelatedIntents(intent) {
        const relatedMap = {
            business_health: ['cash_flow', 'invoices_attention', 'expenses_spend'],
            cash_flow: ['business_health', 'payments_recent'],
            invoices_attention: ['payments_recent', 'customer_insights'],
            payments_recent: ['invoices_attention', 'cash_flow'],
            expenses_spend: ['business_health', 'compliance_status'],
            compliance_status: ['invoices_attention', 'compliance_knowledge']
        };

        return relatedMap[intent] || [];
    }

    /**
     * Get tools for detected intents
     */
    getToolsForIntents(intents) {
        const toolMapping = {
            business_health: ['get_business_advisor_context'],
            cash_flow: ['get_dashboard_snapshot'],
            payments_recent: ['get_payment_workspace'],
            invoices_attention: ['get_invoice_workspace', 'get_overdue_invoices'],
            expenses_spend: ['get_expense_workspace'],
            compliance_status: ['get_compliance_workspace'],
            compliance_knowledge: ['get_knowledge_base'],
            customer_insights: ['get_customer_insights', 'get_customer_details'],
            comparison: ['get_dashboard_snapshot', 'get_invoice_workspace', 'get_payment_workspace'],
            trend: ['get_dashboard_snapshot'],
            action_request: [],
            spending_decision: ['get_dashboard_snapshot', 'get_expense_workspace'],
            profitability: ['get_dashboard_snapshot', 'get_invoice_workspace', 'get_expense_workspace']
        };

        const tools = new Set();
        
        for (const intent of intents) {
            const intentTools = toolMapping[intent] || [];
            intentTools.forEach(t => tools.add(t));
        }

        return Array.from(tools).map(toolId => ({ toolId, args: {} }));
    }

    /**
     * Legacy detect method for backward compatibility
     */
    detect(query = '') {
        const result = this.detectWithConfidence(query);
        return result.primaryIntent;
    }

    /**
     * Get metadata for an intent
     */
    getMetadata(intentId) {
        return {
            id: intentId,
            domain: this.domainMapping[intentId] || 'finance',
            specialistLabel: this.specialistMapping[intentId] || 'Finance Guide'
        };
    }

    /**
     * Check if intent is actionable
     */
    isActionIntent(intentId) {
        return intentId === 'action_request';
    }

    /**
     * Check if intent is conversational
     */
    isConversationalIntent(intentId) {
        return intentId === 'conversational';
    }

    /**
     * Build response based on detected intent
     */
    buildIntentResponse(query, intentResult) {
        const { primaryIntent, confidence, domain, specialistLabel } = intentResult;

        const mode = confidence > 0.8 ? 'high_confidence' : 
                     confidence > 0.6 ? 'medium_confidence' : 'low_confidence';

        return {
            intent: primaryIntent,
            confidence,
            mode,
            primaryDomain: domain,
            specialistLabel,
            tools: this.getToolsForIntents([primaryIntent, ...intentResult.secondaryIntents]),
            requiresComparison: intentResult.requiresComparison,
            requiresReasoning: intentResult.requiresReasoning,
            complexity: intentResult.complexity,
            isConversational: intentResult.isConversational,
            suggestedActions: intentResult.suggestedActions,
            timeRange: intentResult.timeRange,
            parsedEntities: intentResult.parsedEntities
        };
    }
}

export default new AIEnhancedIntentService();