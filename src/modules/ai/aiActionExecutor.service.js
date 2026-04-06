import { supabase } from '../../core/database/supabase.js';

class AIActionExecutorService {
    async execute(action = {}, context = {}) {
        switch (action.type) {
            case 'create_customer':
                return this.createCustomer(action, context);
            default:
                throw new Error(`Unsupported AI action: ${action.type}`);
        }
    }

    async createCustomer(action = {}, context = {}) {
        const payload = action.data || {};
        const name = String(payload.name || '').trim();
        const email = String(payload.email || '').trim() || null;
        const phone = String(payload.phone || '').trim() || null;
        const address = String(payload.address || '').trim() || null;

        if (!name) {
            throw new Error('Customer name is required to execute create_customer');
        }

        if (email) {
            const { data: existing, error: existingError } = await supabase
                .from('customers')
                .select('id, name, email')
                .eq('organization_id', context.organizationId)
                .eq('email', email)
                .maybeSingle();

            if (existingError) throw existingError;
            if (existing) {
                return {
                    status: 'noop',
                    message: `Customer ${existing.name || existing.email} already exists.`,
                    customer: existing
                };
            }
        }

        const { data, error } = await supabase
            .from('customers')
            .insert([{
                name,
                email,
                phone,
                address,
                organization_id: context.organizationId,
                user_id: context.user?.id || null
            }])
            .select()
            .single();

        if (error) throw error;

        return {
            status: 'created',
            message: `Customer ${data.name} created successfully.`,
            customer: data
        };
    }
}

export default new AIActionExecutorService();
