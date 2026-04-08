import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const INTENT_EXAMPLES = [
    { id: 'conversational', query: 'hello hi how are you doing thanks goodbye' },
    { id: 'business_health', query: 'how is my business doing health summary overall performance financial health' },
    { id: 'cash_flow', query: 'cash flow runway liquidity safe to spend burn rate cash position working capital' },
    { id: 'payments_recent', query: 'recent payments received collections money in receipts revenue settled paid' },
    { id: 'invoices_attention', query: 'overdue invoices outstanding receivables who owes me collections due pending unpaid billing' },
    { id: 'expenses_spend', query: 'expenses spending costs vendor burn operating where spent monthly category' },
    { id: 'compliance_status', query: 'compliance tasks deadlines filing GST TDS due upcoming pending returns' },
    { id: 'compliance_knowledge', query: 'GST rules TDS rules tax regulations what is allowed required legal requirements' },
    { id: 'customer_insights', query: 'customer analytics portfolio client health churn retention top biggest at risk' },
    { id: 'action_request', query: 'open dashboard create invoice add customer send payment navigate go to' },
    { id: 'general_advice', query: 'advice recommend suggest best practice tips ideas what should I do' }
];

class AIEmbeddingIntentService {
    constructor() {
        this.genAI = null;
        this.embeddingCache = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.warn('[EmbeddingIntent] No GEMINI_API_KEY, using fallback');
            return;
        }

        try {
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getEmbeddingModel();
            
            const embeddings = await Promise.all(
                INTENT_EXAMPLES.map(async (intent) => {
                    const embedding = await this.getEmbedding(intent.query);
                    return { ...intent, embedding };
                })
            );
            
            for (const item of embeddings) {
                this.embeddingCache.set(item.id, item.embedding);
            }
            
            this.initialized = true;
            console.log('[EmbeddingIntent] Initialized with', INTENT_EXAMPLES.length, 'intents');
        } catch (err) {
            console.error('[EmbeddingIntent] Init failed:', err.message);
        }
    }

    async getEmbedding(text) {
        if (!this.genAI) return null;
        
        const result = await this.model.embedContent(text);
        return result.embedding.values;
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async detectIntent(query) {
        if (!this.initialized) {
            return { id: 'general_advice', confidence: 0.5 };
        }

        try {
            const queryEmbedding = await this.getEmbedding(query);
            if (!queryEmbedding) {
                return { id: 'general_advice', confidence: 0.5 };
            }

            let bestIntent = null;
            let bestScore = -1;

            for (const [id, embedding] of this.embeddingCache) {
                const score = this.cosineSimilarity(queryEmbedding, embedding);
                if (score > bestScore) {
                    bestScore = score;
                    bestIntent = id;
                }
            }

            const confidence = Math.max(0, Math.min(1, bestScore));
            
            return {
                id: bestIntent || 'general_advice',
                confidence,
                method: 'embedding'
            };
        } catch (err) {
            console.error('[EmbeddingIntent] Detection failed:', err.message);
            return { id: 'general_advice', confidence: 0.5 };
        }
    }

    getAllIntents() {
        return INTENT_EXAMPLES.map(i => i.id);
    }
}

export default new AIEmbeddingIntentService();