const COMPLEXITY_INDICATORS = {
    high: [
        'analyze', 'analysis', 'trend', 'trends', 'forecast', 'predict',
        'compare', 'comparison', 'versus', 'vs', 'strategy', 'strategic',
        'optimize', 'optimization', 'recommendation', 'recommendations',
        'why', 'reason', 'because', 'explain', 'reasoning'
    ],
    medium: [
        'summary', 'summarize', 'overview', 'breakdown', 'detailed',
        'what about', 'tell me more', 'expand', 'follow up'
    ],
    low: [
        'what is', 'how much', 'how many', 'show', 'list', 'get',
        'find', 'check', 'status', 'balance', 'total'
    ]
};

// Ordered fallback chain based on actual Gemini Tier-1 rate limits:
//   gemini-2.5-flash      → 1K RPM, 10K RPD  (primary)
//   gemini-2.5-flash-lite → 4K RPM, unlimited (high-headroom fallback)
//   gemini-2.0-flash      → 2K RPM, unlimited (last resort)
const MODEL_TIERS = {
    flash: {
        name: 'gemini-2.5-flash',
        maxTokens: 65536,
        contextWindow: 1_000_000,
        latency: 'fast',
        cost: 2
    },
    flashLite: {
        name: 'gemini-2.5-flash-lite',
        maxTokens: 65536,
        contextWindow: 1_000_000,
        latency: 'fast',
        cost: 1
    },
    flash20: {
        name: 'gemini-2.0-flash',
        maxTokens: 65536,
        contextWindow: 1_000_000,
        latency: 'fast',
        cost: 1
    }
};

// Full ordered fallback chain — used by ai.service.js to build targetModels
export const MODEL_FALLBACK_CHAIN = [
    MODEL_TIERS.flash.name,
    MODEL_TIERS.flashLite.name,
    MODEL_TIERS.flash20.name,
];

class AIModelRouterService {
    detectComplexity(query, toolCount = 0) {
        const text = String(query || '').toLowerCase();

        let score = 0;
        for (const word of COMPLEXITY_INDICATORS.high) {
            if (text.includes(word)) score += 2;
        }
        for (const word of COMPLEXITY_INDICATORS.medium) {
            if (text.includes(word)) score += 1;
        }

        if (toolCount > 3) score += 2;
        if (toolCount > 5) score += 3;

        const isMultiStep = text.includes('and then') || text.includes('also') ||
            text.includes('plus') || text.includes('with that');
        if (isMultiStep) score += 2;

        if (score >= 5) return 'high';
        if (score >= 2) return 'medium';
        return 'low';
    }

    // Returns the best primary model. Fallback chain is handled by ai.service.js
    // using MODEL_FALLBACK_CHAIN so all callers get automatic 429 recovery.
    selectModel(complexity, tier = 'starter') {
        return MODEL_TIERS.flash;
    }

    getAvailableModels() {
        return MODEL_TIERS;
    }

    getFallbackChain() {
        return MODEL_FALLBACK_CHAIN;
    }
}

export default new AIModelRouterService();
