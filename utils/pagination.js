import { LIMITS } from '../config/constants.js';

/**
 * Parse pagination parameters from query string.
 * Supports ?page=1&limit=20 pattern.
 * 
 * @param {Object} query - req.query object
 * @returns {{ page: number, limit: number, offset: number }}
 */
export function parsePagination(query) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(
        LIMITS.MAX_PAGE_LIMIT,
        Math.max(1, parseInt(query.limit) || LIMITS.DEFAULT_PAGE_LIMIT)
    );
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}
