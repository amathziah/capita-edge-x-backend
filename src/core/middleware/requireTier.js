import { supabase } from '../database/supabase.js';

/**
 * In-memory cache for user tiers to reduce database load.
 * Key: userId, Value: { tier: string, timestamp: number }
 */
const tierCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

const TIER_ORDER = ['starter', 'solo', 'solo_pro', 'enterprise'];

/**
 * Normalizes tier names (e.g., 'free' -> 'starter')
 */
const normalizeTier = (tier) => {
    if (!tier || tier === 'free') return 'starter';
    return tier;
};

/**
 * Retrieves a non-expired tier from the cache.
 */
const getCachedTier = (userId) => {
    const entry = tierCache.get(userId);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        tierCache.delete(userId);
        return null;
    }
    return entry.tier;
};

/**
 * Clears the tier cache for a specific user. 
 * Should be called on sign-out or plan upgrade.
 */
export const clearTierCache = (userId) => {
    tierCache.delete(userId);
};

/**
 * Middleware to enforce plan tier requirements.
 * Checks an in-memory cache first, then falls back to Supabase.
 */
export const requireTier = (minTier) => {
    const normalizedMin = normalizeTier(minTier);
    const minTierIndex = TIER_ORDER.indexOf(normalizedMin);

    return async (req, res, next) => {
        const userId = req.user?.id;
        const orgId = req.user?.organizationId;

        if (!userId || !orgId) {
            return res.status(401).json({ error: 'Authentication details missing' });
        }

        try {
            // 1. Check Cache
            let userTier = getCachedTier(userId);

            // 2. Fetch from DB if miss
            if (!userTier) {
                const { data: org, error } = await supabase
                    .from('organizations')
                    .select('plan_tier')
                    .eq('id', orgId)
                    .single();

                if (error || !org) {
                    console.error('[Tier Guard] DB Fetch Failed:', error?.message);
                    return res.status(403).json({ error: 'Failed to verify plan tier' });
                }

                userTier = normalizeTier(org.plan_tier);
                
                // Update Cache
                tierCache.set(userId, {
                    tier: userTier,
                    timestamp: Date.now()
                });
            }

            // 3. Comparison
            const userTierIndex = TIER_ORDER.indexOf(userTier);

            if (userTierIndex < minTierIndex) {
                return res.status(403).json({
                    error: `Upgrade Required`,
                    message: `This feature requires '${minTier}' or higher. You are currently on '${userTier}'.`,
                    requiredTier: normalizedMin,
                    currentTier: userTier
                });
            }

            next();

        } catch (err) {
            console.error('[Tier Guard] Internal Error:', err);
            // Fail closed for security
            return res.status(403).json({ error: 'Tier verification blocked by internal error' });
        }
    };
};
