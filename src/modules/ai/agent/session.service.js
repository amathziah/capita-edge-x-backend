/**
 * AI Session Manager Service
 * 
 * Manages conversation context and state:
 * - Session creation and tracking
 * - Context preservation across messages
 * - Entity memory (customers, invoices mentioned)
 * - Topic tracking
 * - Conversation flow analysis
 */

import { supabase } from '../../../core/database/supabase.js';

class AISessionManagerService {
    constructor() {
        this.sessions = new Map();
        this.maxSessionDuration = 30 * 60 * 1000; // 30 minutes
        this.maxContextMessages = 10;
    }

    /**
     * Get or create session for a conversation
     */
    async getOrCreateSession(organizationId, userId, conversationId = null) {
        let sessionKey = conversationId;
        
        // Create new session if no conversation ID
        if (!sessionKey) {
            sessionKey = this.createSessionId();
        }

        // Check if session exists in memory
        let session = this.sessions.get(sessionKey);
        
        if (!session) {
            // Try to load from database
            session = await this.loadSession(organizationId, sessionKey);
        }

        if (!session) {
            // Create new session
            session = {
                id: sessionKey,
                organizationId,
                userId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                messages: [],
                entities: {
                    customers: [],
                    invoices: [],
                    amounts: [],
                    dates: []
                },
                topics: new Map(),
                topicHistory: [],
                intentHistory: [],
                context: {},
                metadata: {
                    messageCount: 0,
                    totalTokens: 0,
                    currentDomain: null
                }
            };
        }

        // Update last activity
        session.lastActivity = Date.now();

        // Store in memory
        this.sessions.set(sessionKey, session);

        // Clean old sessions
        this.cleanOldSessions();

        return session;
    }

    /**
     * Create new session ID
     */
    createSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Load session from database
     */
    async loadSession(organizationId, sessionId) {
        try {
            const { data, error } = await supabase
                .from('ai_sessions')
                .select('*')
                .eq('id', sessionId)
                .eq('organization_id', organizationId)
                .single();

            if (error || !data) return null;

            // Parse stored data
            return {
                ...data,
                topics: new Map(data.topics || {}),
                entities: data.entities || { customers: [], invoices: [], amounts: [], dates: [] }
            };
        } catch (e) {
            return null;
        }
    }

    /**
     * Save session to database
     */
    async saveSession(session) {
        try {
            await supabase
                .from('ai_sessions')
                .upsert({
                    id: session.id,
                    organization_id: session.organizationId,
                    user_id: session.userId,
                    topics: Object.fromEntries(session.topics),
                    entities: session.entities,
                    context: session.context,
                    metadata: session.metadata,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });
        } catch (e) {
            // Ignore save errors
        }
    }

    /**
     * Add message to session
     */
    addMessage(session, message) {
        const isUser = message.role === 'user';
        
        session.messages.push({
            role: message.role,
            content: message.content,
            timestamp: Date.now(),
            intent: message.intent,
            domain: message.domain
        });

        session.metadata.messageCount++;

        if (isUser && message.intent) {
            session.intentHistory.push(message.intent);
            
            // Update current domain
            if (message.domain) {
                session.metadata.currentDomain = message.domain;
                
                // Track topic
                const topicCount = session.topics.get(message.domain) || 0;
                session.topics.set(message.domain, topicCount + 1);
            }
        }

        // Trim old messages
        if (session.messages.length > this.maxContextMessages * 2) {
            session.messages = session.messages.slice(-this.maxContextMessages);
        }

        return session;
    }

    /**
     * Extract and store entities from message
     */
    extractEntities(session, parsedEntities) {
        const { customers, invoiceNumbers, amounts, dates } = parsedEntities;

        if (customers && customers.length > 0) {
            session.entities.customers = [
                ...session.entities.customers,
                ...customers
            ].slice(-5); // Keep last 5
        }

        if (invoiceNumbers && invoiceNumbers.length > 0) {
            session.entities.invoices = [
                ...session.entities.invoices,
                ...invoiceNumbers
            ].slice(-5);
        }

        if (amounts && amounts.length > 0) {
            session.entities.amounts = [
                ...session.entities.amounts,
                ...amounts
            ].slice(-5);
        }

        if (dates && dates.length > 0) {
            session.entities.dates = [
                ...session.entities.dates,
                ...dates
            ].slice(-5);
        }

        return session;
    }

    /**
     * Update session context
     */
    updateContext(session, key, value) {
        session.context[key] = value;
        return session;
    }

    /**
     * Get relevant context for a query
     */
    getContextForQuery(session, currentQuery) {
        const context = {
            previousMessages: session.messages.slice(-5),
            currentDomain: session.metadata.currentDomain,
            recentIntents: session.intentHistory.slice(-3),
            rememberedEntities: this.getRelevantEntities(session, currentQuery),
            sessionDuration: Date.now() - session.createdAt,
            messageCount: session.metadata.messageCount
        };

        return context;
    }

    /**
     * Get entities relevant to current query
     */
    getRelevantEntities(session, query) {
        const queryLower = query.toLowerCase();
        const relevant = {
            customers: [],
            invoices: [],
            amounts: []
        };

        // Filter customers mentioned in recent queries
        for (const customer of session.entities.customers) {
            if (queryLower.includes(customer.toLowerCase())) {
                relevant.customers.push(customer);
            }
        }

        // All recent invoices
        relevant.invoices = session.entities.invoices.slice(-3);

        // Recent amounts
        relevant.amounts = session.entities.amounts.slice(-3);

        return relevant;
    }

    /**
     * Get current topic
     */
    getCurrentTopic(session) {
        if (session.topics.size === 0) return null;

        let maxCount = 0;
        let currentTopic = null;

        for (const [topic, count] of session.topics) {
            if (count > maxCount) {
                maxCount = count;
                currentTopic = topic;
            }
        }

        return currentTopic;
    }

    /**
     * Detect topic transitions
     */
    detectTopicTransition(session, newDomain) {
        const currentTopic = this.getCurrentTopic(session);
        
        if (!currentTopic) return { isTransition: false, previousTopic: null };
        
        if (currentTopic !== newDomain) {
            return {
                isTransition: true,
                previousTopic: currentTopic,
                newTopic: newDomain
            };
        }

        return { isTransition: false, previousTopic: currentTopic };
    }

    /**
     * Clean old sessions from memory
     */
    cleanOldSessions() {
        const now = Date.now();
        
        for (const [key, session] of this.sessions) {
            if (now - session.lastActivity > this.maxSessionDuration) {
                this.sessions.delete(key);
            }
        }
    }

    /**
     * End session
     */
    async endSession(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (session) {
            // Save to database
            await this.saveSession(session);
            
            // Remove from memory
            this.sessions.delete(sessionId);
        }
    }

    /**
     * Get session summary
     */
    getSessionSummary(session) {
        return {
            id: session.id,
            messageCount: session.metadata.messageCount,
            currentDomain: session.metadata.currentDomain,
            topics: Object.fromEntries(session.topics),
            entities: {
                customers: session.entities.customers.length,
                invoices: session.entities.invoices.length
            },
            duration: Date.now() - session.createdAt,
            intents: session.intentHistory.slice(-5)
        };
    }

    /**
     * Build context for AI service
     */
    buildAIContext(session, query) {
        const context = this.getContextForQuery(session, query);
        
        return {
            sessionId: session.id,
            previousMessages: context.previousMessages.map(m => ({
                role: m.role,
                content: m.content
            })),
            currentDomain: context.currentDomain,
            lastIntent: context.recentIntents[context.recentIntents.length - 1],
            rememberedContext: context.rememberedEntities,
            messageCount: context.messageCount,
            isFollowUp: context.messageCount > 0 && query.split(/\s+/).length <= 10
        };
    }
}

export default new AISessionManagerService();