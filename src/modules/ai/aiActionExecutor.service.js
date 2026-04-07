import { supabase } from '../../core/database/supabase.js';

class AIActionExecutorService {
    async execute(action = {}, context = {}) {
        switch (action.type) {
            case 'create_customer':
                return this.createCustomer(action, context);
            case 'create_invoice':
                return this.createInvoice(action, context);
            case 'record_payment':
                return this.recordPayment(action, context);
            case 'record_expense':
                return this.recordExpense(action, context);
            case 'navigate':
                return { status: 'navigated', ...action.data };
            case 'open_invoice_modal':
                return { status: 'open_modal', modal: 'create_invoice' };
            case 'open_customer_modal':
                return { status: 'open_modal', modal: 'create_customer' };
            case 'open_payment_modal':
                return { status: 'open_modal', modal: 'record_payment' };
            case 'open_expense_modal':
                return { status: 'open_modal', modal: 'record_expense' };
            default:
                return { status: 'noop', message: 'Action not executable directly' };
        }
    }

    async createCustomer(action = {}, context = {}) {
        const payload = action.data || {};
        const name = String(payload.name || '').trim();
        const email = String(payload.email || '').trim() || null;
        const phone = String(payload.phone || '').trim() || null;
        const address = String(payload.address || '').trim() || null;

        if (!name) {
            throw new Error('Customer name is required');
        }

        if (email) {
            const { data: existing } = await supabase
                .from('customers')
                .select('id, name, email')
                .eq('organization_id', context.organizationId)
                .eq('email', email)
                .maybeSingle();

            if (existing) {
                return { status: 'exists', customer: existing };
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

        return { status: 'created', customer: data };
    }

    async createInvoice(action = {}, context = {}) {
        const payload = action.data || {};
        
        return {
            status: 'ready',
            message: 'Opening invoice creation form',
            prefill: payload
        };
    }

    async recordPayment(action = {}, context = {}) {
        const payload = action.data || {};
        
        return {
            status: 'ready',
            message: 'Opening payment recording form',
            prefill: payload
        };
    }

    async recordExpense(action = {}, context = {}) {
        const payload = action.data || {};
        
        return {
            status: 'ready',
            message: 'Opening expense recording form',
            prefill: payload
        };
    }
}

export default new AIActionExecutorService();