/**
 * AI Semantic Search Service
 * 
 * Advanced knowledge base search using:
 * - TF-IDF scoring
 * - Keyword expansion with synonyms
 * - Context-aware ranking
 * - Related term matching
 */

import { supabase } from '../../../core/database/supabase.js';

class AISemanticSearchService {
    constructor() {
        this.stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
            'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
            'into', 'through', 'during', 'before', 'after', 'above', 'below',
            'between', 'under', 'again', 'further', 'then', 'once', 'here',
            'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
            'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
            'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'it',
            'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
            'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
            'she', 'her', 'they', 'them', 'their', 'its', 'am', 'about'
        ]);

        this.synonymGroups = {
            'gst': ['goods and services tax', 'gst', ' Goods & Services Tax '],
            'tds': ['tax deducted at source', 'tds', 'withholding tax'],
            'invoice': ['bill', 'receipt', 'tax invoice', 'commercial invoice'],
            'payment': ['receipt', 'settlement', 'transaction', 'collection'],
            'expense': ['cost', 'expenditure', 'spending', 'outflow'],
            'customer': ['client', 'buyer', 'customer', 'patron'],
            'compliance': ['regulation', 'adherence', 'rules', 'requirements'],
            'deadline': ['due date', 'last date', 'last day', 'submission date'],
            'filing': ['submission', 'return', 'report', 'declaration'],
            'tax': ['taxation', 'taxes', 'levy', 'duty'],
            'business': ['company', 'firm', 'enterprise', 'organization'],
            'revenue': ['income', 'earnings', 'sales', 'turnover'],
            'profit': ['gain', 'earnings', 'net income', 'margin'],
            'cash': ['money', 'funds', 'liquidity', 'capital'],
            'overdue': ['late', 'delayed', 'past due', 'unpaid']
        };

        this.domainKeywords = {
            invoices: ['invoice', 'bill', 'receipt', 'due date', 'payment', 'customer', 'tax invoice', 'gst invoice', 'igst', 'cgst', 'sgst', 'taxable', 'total', 'subtotal', 'balance'],
            payments: ['payment', 'receipt', 'collection', 'received', 'transaction', 'settlement', 'method', 'cash', 'cheque', 'upi', 'bank transfer', 'mode'],
            expenses: ['expense', 'cost', 'spending', 'vendor', 'supplier', 'category', 'amount', 'date', 'description', 'receipt'],
            compliance: ['gst', 'tds', 'filing', 'return', 'deadline', 'due date', 'form', 'section', 'tax', 'compliance', 'registration', 'certificate'],
            customers: ['customer', 'client', 'buyer', 'contact', 'email', 'phone', 'address', 'name', 'business'],
            general: ['business', 'finance', 'accounting', 'record', 'report', 'summary', 'overview']
        };

        this.maxResults = 10;
        this.minScoreThreshold = 0.1;
    }

    /**
     * Main search method - semantic search across knowledge base
     */
    async search(organizationId, query, options = {}) {
        const { domain, limit = this.maxResults, includeContent = true } = options;

        if (!organizationId || !query) {
            return { results: [], total: 0, query: '' };
        }

        // Get all knowledge base entries
        const { data: knowledge, error } = await supabase
            .from('business_knowledge')
            .select('*')
            .eq('organization_id', organizationId);

        if (error || !knowledge || knowledge.length === 0) {
            return { results: [], total: 0, query, hasKnowledgeBase: false };
        }

        // Expand query with synonyms
        const expandedQuery = this.expandQuery(query);
        
        // Calculate TF-IDF scores
        const queryTerms = this.tokenize(expandedQuery);
        const documentScores = this.calculateDocumentScores(knowledge, queryTerms, domain);

        // Sort by score
        documentScores.sort((a, b) => b.score - a.score);

        // Filter by threshold and limit
        const filteredResults = documentScores
            .filter(doc => doc.score >= this.minScoreThreshold)
            .slice(0, limit);

        // Format results
        const results = filteredResults.map(doc => ({
            id: doc.entry.id,
            title: doc.entry.title,
            category: doc.entry.category,
            content: includeContent ? doc.entry.content : null,
            tags: doc.entry.tags || [],
            score: doc.score,
            matchedTerms: doc.matchedTerms,
            domain: this.detectDomain(doc.entry.title, doc.entry.content),
            highlights: this.generateHighlights(doc.entry.content, queryTerms)
        }));

        return {
            results,
            total: filteredResults.length,
            query: expandedQuery,
            hasKnowledgeBase: true,
            searchMetadata: {
                originalQuery: query,
                expandedQuery,
                termsUsed: queryTerms,
                domainFilter: domain
            }
        };
    }

    /**
     * Expand query with synonyms and related terms
     */
    expandQuery(query) {
        const normalizedQuery = String(query || '').toLowerCase();
        const terms = this.tokenize(normalizedQuery);
        const expandedTerms = new Set(terms);

        for (const term of terms) {
            // Add synonyms
            if (this.synonymGroups[term]) {
                this.synonymGroups[term].forEach(synonym => {
                    expandedTerms.add(synonym);
                });
            }

            // Add related terms
            const relatedTerms = this.findRelatedTerms(term);
            relatedTerms.forEach(rt => expandedTerms.add(rt));
        }

        return Array.from(expandedTerms).join(' ');
    }

    /**
     * Find related terms from domain keywords
     */
    findRelatedTerms(term) {
        const relatedTerms = [];

        // Check if term matches any domain
        for (const [domain, keywords] of Object.entries(this.domainKeywords)) {
            if (keywords.includes(term)) {
                relatedTerms.push(...keywords.filter(k => k !== term));
            }
        }

        // Add common business terms based on categories
        if (['revenue', 'income', 'sales'].includes(term)) {
            relatedTerms.push('money', 'cash', 'collection', 'payment');
        }
        if (['expense', 'cost', 'spend'].includes(term)) {
            relatedTerms.push('vendor', 'supplier', 'category', 'amount');
        }
        if (['overdue', 'late', 'pending'].includes(term)) {
            relatedTerms.push('due date', 'payment', 'collection', 'follow up');
        }

        return relatedTerms;
    }

    /**
     * Tokenize query into terms
     */
    tokenize(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(term => term.length > 2 && !this.stopWords.has(term));
    }

    /**
     * Calculate TF-IDF scores for documents
     */
    calculateDocumentScores(documents, queryTerms, domainFilter = null) {
        const scores = [];

        // Calculate document frequencies
        const termDocFrequency = {};
        for (const doc of documents) {
            const docTerms = new Set(this.tokenize(`${doc.title} ${doc.content || ''}`));
            for (const term of queryTerms) {
                if (docTerms.has(term)) {
                    termDocFrequency[term] = (termDocFrequency[term] || 0) + 1;
                }
            }
        }

        for (const doc of documents) {
            // Skip if domain filter doesn't match
            if (domainFilter && !this.matchesDomain(doc, domainFilter)) {
                continue;
            }

            const docText = `${doc.title} ${doc.content || ''} ${(doc.tags || []).join(' ')}`;
            const docTerms = this.tokenize(docText);
            const docTermSet = new Set(docTerms);

            let score = 0;
            const matchedTerms = [];

            // Calculate TF-IDF score
            for (const queryTerm of queryTerms) {
                if (docTermSet.has(queryTerm)) {
                    // Term frequency in document
                    const tf = docTerms.filter(t => t === queryTerm).length;
                    
                    // Inverse document frequency
                    const docFreq = termDocFrequency[queryTerm] || 1;
                    const idf = Math.log(documents.length / docFreq);

                    // TF-IDF score
                    const termScore = (1 + Math.log(tf)) * idf;
                    score += termScore;
                    
                    if (!matchedTerms.includes(queryTerm)) {
                        matchedTerms.push(queryTerm);
                    }
                }

                // Bonus for title matches
                if (doc.title?.toLowerCase().includes(queryTerm)) {
                    score += 0.5;
                }

                // Bonus for tag matches
                if (doc.tags?.some(tag => tag.toLowerCase().includes(queryTerm))) {
                    score += 0.3;
                }
            }

            // Normalize by query length
            if (queryTerms.length > 0) {
                score = score / Math.sqrt(queryTerms.length);
            }

            // Category boost
            const categoryBoost = this.getCategoryBoost(doc.category, queryTerms);
            score += categoryBoost;

            scores.push({
                entry: doc,
                score,
                matchedTerms
            });
        }

        return scores;
    }

    /**
     * Check if document matches domain filter
     */
    matchesDomain(doc, domain) {
        const category = (doc.category || '').toLowerCase();
        return category.includes(domain.toLowerCase());
    }

    /**
     * Get category boost based on query terms
     */
    getCategoryBoost(category, queryTerms) {
        if (!category) return 0;

        const categoryLower = category.toLowerCase();
        let boost = 0;

        for (const term of queryTerms) {
            if (this.domainKeywords[categoryLower]?.includes(term)) {
                boost += 0.2;
            }
        }

        return boost;
    }

    /**
     * Detect domain from content
     */
    detectDomain(title, content) {
        const text = `${title || ''} ${content || ''}`.toLowerCase();

        const domainScores = {};

        for (const [domain, keywords] of Object.entries(this.domainKeywords)) {
            let score = 0;
            for (const keyword of keywords) {
                if (text.includes(keyword)) {
                    score += 1;
                }
            }
            domainScores[domain] = score;
        }

        // Find highest scoring domain
        let maxScore = 0;
        let detectedDomain = 'general';

        for (const [domain, score] of Object.entries(domainScores)) {
            if (score > maxScore) {
                maxScore = score;
                detectedDomain = domain;
            }
        }

        return detectedDomain;
    }

    /**
     * Generate content highlights
     */
    generateHighlights(content, queryTerms) {
        if (!content || !queryTerms || queryTerms.length === 0) {
            return [];
        }

        const highlights = [];
        const contentLower = content.toLowerCase();

        // Find sentences containing query terms
        const sentences = content.split(/[.!?]+/);

        for (const sentence of sentences) {
            const sentenceLower = sentence.toLowerCase();
            for (const term of queryTerms) {
                if (sentenceLower.includes(term.toLowerCase())) {
                    // Extract relevant portion
                    const maxLength = 150;
                    let highlight = sentence.trim();
                    if (highlight.length > maxLength) {
                        const termIndex = highlight.toLowerCase().indexOf(term.toLowerCase());
                        const start = Math.max(0, termIndex - 50);
                        const end = Math.min(highlight.length, termIndex + 100);
                        highlight = (start > 0 ? '...' : '') + highlight.slice(start, end) + (end < highlight.length ? '...' : '');
                    }
                    highlights.push(highlight);
                    break;
                }
            }

            if (highlights.length >= 3) break;
        }

        return highlights;
    }

    /**
     * Get relevant knowledge for specific topics
     */
    async getTopicKnowledge(organizationId, topics) {
        const results = [];

        for (const topic of topics) {
            const searchResult = await this.search(organizationId, topic, { limit: 3 });
            results.push({
                topic,
                knowledge: searchResult.results
            });
        }

        return results;
    }

    /**
     * Get compliance-related knowledge
     */
    async getComplianceKnowledge(organizationId, query) {
        return this.search(organizationId, query, { 
            domain: 'compliance',
            limit: 5 
        });
    }

    /**
     * Get invoice-related knowledge
     */
    async getInvoiceKnowledge(organizationId, query) {
        return this.search(organizationId, query, { 
            domain: 'invoices',
            limit: 5 
        });
    }
}

export default new AISemanticSearchService();