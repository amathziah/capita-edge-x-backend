import { GoogleGenerativeAI } from '@google/generative-ai';

class AIRuntimeService {
    constructor({ apiKey } = {}) {
        this.apiKey = apiKey;
        this.pendingRequests = new Map();
        this.circuitStatus = { open: false, until: 0 };
        this.rateBucket = {
            tokens: 60,
            maxTokens: 60,
            refillRate: 15,
            lastRefill: Date.now(),
        };

        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            console.warn('⚠️  Gemini API key not configured. AI features will use fallback logic.');
            this.genAI = null;
        } else {
            this.genAI = new GoogleGenerativeAI(apiKey);
            console.log('📡 AI Service Activated — Tier-aware routing enabled');
        }
    }

    hasModelClient() {
        return Boolean(this.genAI);
    }

    canMakeRequest() {
        const now = Date.now();
        const elapsed = (now - this.rateBucket.lastRefill) / 60000;
        const refill = Math.floor(elapsed * this.rateBucket.refillRate);
        if (refill > 0) {
            this.rateBucket.tokens = Math.min(this.rateBucket.maxTokens, this.rateBucket.tokens + refill);
            this.rateBucket.lastRefill = now;
        }
        return this.rateBucket.tokens > 0;
    }

    consumeToken() {
        this.rateBucket.tokens = Math.max(0, this.rateBucket.tokens - 1);
    }

    getModel(modelName, isJson = false) {
        if (!this.genAI) return null;

        const config = {
            model: modelName,
            generationConfig: isJson ? {
                maxOutputTokens: 800,
                responseMimeType: 'application/json'
            } : {
                maxOutputTokens: 1500,
                temperature: 0.7,
            }
        };

        return this.genAI.getGenerativeModel(config);
    }

    sanitiseHistory(history = []) {
        const filtered = history.filter(h => {
            const text = h?.parts?.[0]?.text || '';
            return text.trim().length > 0;
        });

        const valid = [];
        let expectedRole = 'user';
        for (const h of filtered) {
            if (h.role === expectedRole) {
                valid.push(h);
                expectedRole = expectedRole === 'user' ? 'model' : 'user';
            }
        }

        if (valid.length > 0 && valid[valid.length - 1].role === 'user') {
            valid.pop();
        }

        return valid;
    }

    isCircuitOpen() {
        if (!this.circuitStatus.open) return false;
        if (Date.now() > this.circuitStatus.until) {
            this.circuitStatus.open = false;
            return false;
        }
        return true;
    }

    openCircuit() {
        const cooldown = 60000;
        this.circuitStatus = { open: true, until: Date.now() + cooldown };
    }

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

    isRetryable(error) {
        if (!error) return false;
        const msg = error.message?.toLowerCase() || '';
        const status = error.status || error.statusCode || 0;

        const isTransient = (
            status === 429 || status === 503 ||
            msg.includes('429') || msg.includes('quota') ||
            msg.includes('overloaded') || msg.includes('rate limit')
        );

        const isConfigError = (
            status === 404 || msg.includes('not found') || msg.includes('not supported')
        );

        return isTransient || isConfigError;
    }
}

export default AIRuntimeService;
