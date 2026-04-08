import crypto from 'crypto';
import redisService from '../../../core/services/redis.service.js';

class AIDeduplicationService {
    constructor() {
        this.prefix = 'ai:dedup';
        this.defaultTTL = 30;
    }

    hashRequest(params) {
        const normalized = {
            organizationId: params.organizationId,
            query: params.query?.toLowerCase().trim(),
            contextKeys: params.contextKeys?.sort()
        };
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(normalized))
            .digest('hex')
            .slice(0, 16);
    }

    async checkAndMark(organizationId, params, ttlSeconds = 30) {
        const hash = this.hashRequest(params);
        const key = `${this.prefix}:${organizationId}:${hash}`;
        
        const isNew = await redisService.setNx(key, { 
            query: params.query,
            timestamp: Date.now() 
        }, ttlSeconds);
        
        return {
            isDuplicate: !isNew,
            hash,
            canProceed: isNew
        };
    }

    async markComplete(organizationId, params) {
        const hash = this.hashRequest(params);
        const key = `${this.prefix}:${organizationId}:${hash}`;
        await redisService.del(key);
    }

    async clearOrgDeduplications(organizationId) {
        if (!redisService.isReady()) return;
        
        const client = redisService.getClient();
        const keys = await client.keys(`${this.prefix}:${organizationId}:*`);
        
        if (keys?.length) {
            await client.del(...keys);
        }
    }
}

export default new AIDeduplicationService();