import crypto from 'crypto';
import redisService from '../../core/services/redis.service.js';
import circuitBreakerService from '../../core/services/circuitBreaker.service.js';

class AICacheService {
    constructor() {
        this.prefix = 'ai:cache';
    }

    hashKey(input) {
        return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
    }

    async get(key) {
        const fullKey = `${this.prefix}:${this.hashKey(key)}`;
        return redisService.get(fullKey);
    }

    async set(key, value, ttlSeconds = 300) {
        const fullKey = `${this.prefix}:${this.hashKey(key)}`;
        return redisService.set(fullKey, value, ttlSeconds);
    }

    async getOrExecute(key, executor, ttlSeconds = 300) {
        const cached = await this.get(key);
        if (cached) {
            return { data: cached, cached: true };
        }

        const data = await executor();
        if (data) {
            await this.set(key, data, ttlSeconds);
        }
        return { data, cached: false };
    }

    async invalidate(key) {
        const fullKey = `${this.prefix}:${this.hashKey(key)}`;
        return redisService.del(fullKey);
    }

    async clear() {
        if (!redisService.isReady()) return;
        const keys = await redisService.getClient().keys(`${this.prefix}:*`);
        if (keys?.length) {
            await redisService.getClient().del(...keys);
        }
    }
}

export default new AICacheService();