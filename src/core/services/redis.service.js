import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config();

class RedisService {
    constructor() {
        this.client = null;
        this.isConnected = false;
    }

    async connect() {
        if (this.client) return this.client;

        const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL || null;

        if (!redisUrl) {
            console.warn('[Redis] No REDIS_URL configured, caching disabled');
            return null;
        }

        try {
            const urlObj = new URL(redisUrl);
            const token = urlObj.password;
            const host = urlObj.hostname;

            this.client = new Redis({
                url: 'https://' + host,
                token: token
            });

            await this.client.ping();
            this.isConnected = true;
            console.log('[Redis] Connected to Upstash');
            return this.client;
        } catch (err) {
            console.error('[Redis] Connection failed:', err.message);
            return null;
        }
    }

    getClient() {
        return this.client;
    }

    isReady() {
        return this.isConnected && this.client;
    }

    async get(key) {
        if (!this.isReady()) return null;
        try {
            const val = await this.client.get(key);
            return val ?? null;
        } catch {
            return null;
        }
    }

    async set(key, value, ttlSeconds = 300) {
        if (!this.isReady()) return false;
        try {
            const stored = typeof value === 'string' ? value : JSON.stringify(value);
            await this.client.set(key, stored, { ex: ttlSeconds });
            return true;
        } catch {
            return false;
        }
    }

    async setNx(key, value, ttlSeconds = 60) {
        if (!this.isReady()) return false;
        try {
            const stored = typeof value === 'string' ? value : JSON.stringify(value);
            const result = await this.client.set(key, stored, { nx: true, ex: ttlSeconds });
            return result === 'OK';
        } catch {
            return false;
        }
    }

    async del(key) {
        if (!this.isReady()) return false;
        try {
            await this.client.del(key);
            return true;
        } catch {
            return false;
        }
    }

    async incrWithTTL(key, ttlSeconds = 60) {
        if (!this.isReady()) return 0;
        try {
            const val = await this.client.incr(key);
            if (val === 1) {
                await this.client.expire(key, ttlSeconds);
            }
            return val;
        } catch {
            return 0;
        }
    }

    async getTTL(key) {
        if (!this.isReady()) return -2;
        try {
            return await this.client.ttl(key);
        } catch {
            return -2;
        }
    }

    async close() {
        if (this.client) {
            this.client = null;
            this.isConnected = false;
        }
    }
}

export default new RedisService();