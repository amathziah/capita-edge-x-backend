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

const MODEL_TIERS = {
    flash: {
        name: 'gemini-2.5-flash',
        maxTokens: 125000,
        contextWindow: 1000000,
        latency: 'fast',
        cost: 1
    }
};

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

    selectModel(complexity, tier = 'starter') {
        return MODEL_TIERS.flash;
    }

    getAvailableModels() {
        return MODEL_TIERS;
    }
}

export default new AIModelRouterService();