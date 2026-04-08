import redisService from '../services/redis.service.js';
import tierConfig from '../config/tierConfig.js';

class AIRateLimiter {
    constructor() {
        this.prefix = 'ai:ratelimit';
    }

    getLimitForTier(tier) {
        const limits = tierConfig.planQueries;
        return limits[tier] || limits.starter;
    }

    async checkLimit(organizationId, tier = 'starter') {
        const limit = this.getLimitForTier(tier);
        const key = `${this.prefix}:org:${organizationId}`;
        
        const current = await redisService.incrWithTTL(key, 86400);
        
        return {
            allowed: current <= limit,
            current,
            limit,
            remaining: Math.max(0, limit - current),
            resetAt: Date.now() + 86400
        };
    }

    async getStatus(organizationId) {
        const key = `${this.prefix}:org:${organizationId}`;
        const current = await redisService.get(key);
        return current || 0;
    }

    async reset(organizationId) {
        const key = `${this.prefix}:org:${organizationId}`;
        return redisService.del(key);
    }
}

export default new AIRateLimiter();