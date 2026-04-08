/**
 * AI Caching Service
 * 
 * Multi-layer caching for AI responses:
 * - In-memory LRU cache for fast access
 * - Database persistence for session continuity
 * - Cache invalidation strategies
 * - Query normalization
 */

import { supabase } from '../../../core/database/supabase.js';

class AICachingService {
    constructor() {
        this.memoryCache = new Map();
        this.CACHE_TTL = {
            chat: 5 * 60 * 1000,        // 5 minutes
            workspace: 2 * 60 * 1000,   // 2 minutes
            analytics: 5 * 60 * 1000,   // 5 minutes
            knowledge: 30 * 60 * 1000,  // 30 minutes
            intent: 10 * 60 * 1000      // 10 minutes
        };
        this.maxMemoryItems = 500;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    /**
     * Get cache key for a query
     */
    getCacheKey(type, organizationId, identifier) {
        const normalizedId = String(identifier || '').toLowerCase().trim();
        return `${type}:${organizationId}:${this.hashString(normalizedId)}`;
    }

    /**
     * Simple hash function for cache keys
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Normalize query for caching
     */
    normalizeQuery(query) {
        return String(query || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '')
            .slice(0, 200);
    }

    /**
     * Get from memory cache
     */
    getFromMemory(key) {
        const entry = this.memoryCache.get(key);
        
        if (!entry) {
            this.cacheMisses++;
            return null;
        }

        // Check expiration
        if (Date.now() > entry.expiresAt) {
            this.memoryCache.delete(key);
            this.cacheMisses++;
            return null;
        }

        // LRU: move to end
        this.memoryCache.delete(key);
        this.memoryCache.set(key, entry);
        
        this.cacheHits++;
        return entry.data;
    }

    /**
     * Set memory cache
     */
    setMemoryCache(key, data, type = 'chat') {
        const ttl = this.CACHE_TTL[type] || this.CACHE_TTL.chat;
        
        // Evict if at capacity
        if (this.memoryCache.size >= this.maxMemoryItems) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
        }

        this.memoryCache.set(key, {
            data,
            expiresAt: Date.now() + ttl,
            createdAt: Date.now()
        });
    }

    /**
     * Get cached response
     */
    async get(type, organizationId, query) {
        const key = this.getCacheKey(type, organizationId, query);
        
        // Check memory first
        const memoryResult = this.getFromMemory(key);
        if (memoryResult) {
            return { source: 'memory', data: memoryResult };
        }

        // Check database for persistent cache
        if (type === 'chat') {
            const dbResult = await this.getFromDatabase(key);
            if (dbResult) {
                // Populate memory cache
                this.setMemoryCache(key, dbResult, type);
                return { source: 'database', data: dbResult };
            }
        }

        return null;
    }

    /**
     * Get from database cache
     */
    async getFromDatabase(key) {
        try {
            const { data, error } = await supabase
                .from('ai_cache')
                .select('cached_data, expires_at')
                .eq('cache_key', key)
                .gt('expires_at', new Date().toISOString())
                .single();

            if (error || !data) return null;

            return data.cached_data;
        } catch (e) {
            return null;
        }
    }

    /**
     * Set cache
     */
    async set(type, organizationId, query, data, options = {}) {
        const key = this.getCacheKey(type, organizationId, query);
        
        // Always cache in memory
        this.setMemoryCache(key, data, type);

        // Optionally persist to database for chat
        if (type === 'chat' && options.persist) {
            await this.setInDatabase(key, data, this.CACHE_TTL.chat);
        }
    }

    /**
     * Set database cache
     */
    async setInDatabase(key, data, ttl) {
        try {
            await supabase
                .from('ai_cache')
                .upsert({
                    cache_key: key,
                    cached_data: data,
                    expires_at: new Date(Date.now() + ttl).toISOString(),
                    created_at: new Date().toISOString()
                }, { onConflict: 'cache_key' });
        } catch (e) {
            // Ignore DB cache errors
        }
    }

    /**
     * Invalidate cache for an organization
     */
    async invalidate(organizationId, pattern = null) {
        // Clear memory cache
        for (const [key] of this.memoryCache) {
            if (key.includes(organizationId)) {
                this.memoryCache.delete(key);
            }
        }

        // Optionally clear database cache
        if (pattern) {
            try {
                await supabase
                    .from('ai_cache')
                    .delete()
                    .like('cache_key', `${pattern}:${organizationId}%`);
            } catch (e) {
                // Ignore
            }
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const total = this.cacheHits + this.cacheMisses;
        const hitRate = total > 0 ? (this.cacheHits / total) * 100 : 0;

        return {
            memoryItems: this.memoryCache.size,
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: hitRate.toFixed(2) + '%',
            ttl: this.CACHE_TTL
        };
    }

    /**
     * Preload cache for common queries
     */
    async preload(organizationId, queries) {
        for (const { type, query } of queries) {
            await this.get(type, organizationId, query);
        }
    }

    /**
     * Clean up expired cache entries
     */
    async cleanup() {
        // Clean memory
        const now = Date.now();
        for (const [key, entry] of this.memoryCache) {
            if (now > entry.expiresAt) {
                this.memoryCache.delete(key);
            }
        }

        // Clean database (keep last 24 hours)
        try {
            await supabase
                .from('ai_cache')
                .delete()
                .lt('expires_at', new Date().toISOString());
        } catch (e) {
            // Ignore
        }
    }
}

export default new AICachingService();