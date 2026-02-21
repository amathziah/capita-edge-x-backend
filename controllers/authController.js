import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';

/**
 * Provision a new organization for a user
 * This is called AFTER Supabase Auth signup
 */
export const provisionOrganization = async (req, res) => {
    const { companyName } = req.body;
    const userId = req.user.id;

    if (!companyName) {
        throw new APIError('Company name is required', 400);
    }

    // 1. Check if user already has an organization
    const { data: existingOrg } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1);

    if (existingOrg && existingOrg.length > 0) {
        return res.status(400).json({
            error: 'User already belongs to an organization',
            organizationId: existingOrg[0].organization_id
        });
    }

    try {
        // 2. Create the Organization
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .insert([{
                name: companyName,
                slug: companyName.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, ''),
                plan: 'starter'
            }])
            .select()
            .single();

        if (orgError) throw new Error(`Org Creation Failed: ${orgError.message}`);

        // 3. Link User as Owner
        const { error: linkError } = await supabase
            .from('organization_users')
            .insert([{
                organization_id: org.id,
                user_id: userId,
                role: 'owner'
            }]);

        if (linkError) throw new Error(`User Linking Failed: ${linkError.message}`);

        // 4. Seed Default Configs
        await supabase.from('organization_configs').insert([
            {
                organization_id: org.id,
                currency: 'INR',
                tax_label: 'GST',
                invoice_prefix: 'INV-'
            }
        ]);

        // 5. Seed Default Accounts for COA
        await supabase.from('accounts').insert([
            { organization_id: org.id, name: 'Accounts Receivable', account_type: 'asset' },
            { organization_id: org.id, name: 'Sales Revenue', account_type: 'revenue' },
            { organization_id: org.id, name: 'Bank', account_type: 'asset' },
            { organization_id: org.id, name: 'Cash on Hand', account_type: 'asset' }
        ]);

        res.status(201).json({
            success: true,
            organization: org
        });

    } catch (error) {
        console.error('[Provisioning Error]:', error);
        throw new APIError(error.message || 'Provisioning failed', 500);
    }
};
