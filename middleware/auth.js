import { supabase } from '../supabase.js';
import dotenv from 'dotenv';
dotenv.config();

export const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const orgIdHeader = req.headers['x-organization-id'];

    if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header provided' });
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        // --- DEVELOPER BYPASS ---
        if (token === 'mock-token-xyz-developer-bypass') {
            const activeClientId = req.headers['x-active-client-id'];
            const mockOrgId = orgIdHeader || 'mock-org-id';
            req.user = {
                id: '02422ae6-2dcf-4ba0-aab5-9bc88710467d',
                email: 'admin@zia.ai',
                organizationId: (activeClientId && activeClientId !== 'null' && activeClientId !== 'undefined')
                    ? activeClientId
                    : mockOrgId,
                role: 'owner',
                ...(activeClientId && activeClientId !== 'null' && activeClientId !== 'undefined' && {
                    isActingAsCA: true,
                    caOrganizationId: mockOrgId
                })
            };
            return next();
        }
        // ------------------------

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.error('Auth Error:', error);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // --- ORGANIZATION CONTEXT RESOLUTION ---
        let organizationId = orgIdHeader;
        if (organizationId === 'null' || organizationId === 'undefined') organizationId = null;

        // Skip organization enforced check ONLY for provisioning
        if (req.path.endsWith('/provision')) {
            req.user = { ...user };
            return next();
        }

        let role = 'staff'; // Default safest role

        if (organizationId) {
            // 1. Verify user belongs to this specific Org

            const { data: orgUser, error: orgError } = await supabase
                .from('organization_users')
                .select('role')
                .eq('organization_id', organizationId)
                .eq('user_id', user.id)
                .single();

            if (orgError || !orgUser) {
                return res.status(403).json({ error: 'User does not belong to this organization' });
            }
            role = orgUser.role;
        } else {
            // 2. Fetch default organization (Try to find one where they are owner, or just the first one)
            const { data: orgs, error: fetchError } = await supabase
                .from('organization_users')
                .select('organization_id, role')
                .eq('user_id', user.id)
                .limit(1);

            if (orgs && orgs.length > 0) {
                organizationId = orgs[0].organization_id;
                role = orgs[0].role;
            } else {
                // Edge case: User has no organization (migration not run or new user)
                // We MUST ERROR here because downstream routes expect an Org ID.
                console.error(`[Auth] User ${user.id} has no organization memberships.`);
                return res.status(403).json({ error: 'User does not belong to any organization. Please contact support.' });
            }
        }

        // Attach enriched user context
        req.user = {
            ...user,
            organizationId,
            role
        };

        // --- CA CLIENT CONTEXT SWITCHING ---
        const activeClientId = req.headers['x-active-client-id'];
        if (activeClientId && activeClientId !== 'null' && activeClientId !== 'undefined') {
            const caOrganizationId = req.user.organizationId;

            const { data: relationship, error: relError } = await supabase
                .from('ca_client_relationships')
                .select('client_organization_id')
                .eq('ca_organization_id', caOrganizationId)
                .eq('client_organization_id', activeClientId)
                .eq('status', 'active')
                .maybeSingle();

            if (relError) {
                console.error('[Auth] CA client relationship query failed:', relError);
                return res.status(500).json({ error: 'Failed to verify client access' });
            }

            if (!relationship) {
                return res.status(403).json({ error: 'Unauthorized client access' });
            }

            req.user.organizationId = activeClientId;
            req.user.isActingAsCA = true;
            req.user.caOrganizationId = caOrganizationId;
        }
        // ------------------------------------

        next();
    } catch (err) {
        console.error('Internal Auth Error:', err);
        return res.status(500).json({ error: 'Internal Server Authentication Error' });
    }
};
