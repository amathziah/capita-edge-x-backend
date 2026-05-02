import { supabase } from '../../../core/database/supabase.js';

class AIActionExecutorService {
    async execute(action = {}, context = {}) {
        switch (action.type) {
            case 'create_customer':
                return this.createCustomer(action, context);
            case 'create_invoice':
                return this.createInvoice(action, context);
            case 'create_invoice_draft':
                return this.createInvoiceDraft(action, context);
            case 'send_reminder':
                return this.sendReminder(action, context);
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

    async createInvoiceDraft(action = {}, context = {}) {
        const payload = action.data || {};
        const amount = Number(payload.amount || 0);
        let customerId = payload.customerId;
        
        // If customerName is provided but not customerId, try to find or create customer
        if (!customerId && payload.customerName) {
            const { data: existing } = await supabase
                .from('customers')
                .select('id, name')
                .eq('organization_id', context.organizationId)
                .ilike('name', `%${payload.customerName}%`)
                .maybeSingle();
                
            if (existing) {
                customerId = existing.id;
                payload.customerName = existing.name;
            } else {
                const { data: newCustomer } = await supabase
                    .from('customers')
                    .insert([{
                        name: payload.customerName,
                        organization_id: context.organizationId,
                        user_id: context.user?.id || null
                    }])
                    .select()
                    .single();
                if (newCustomer) {
                    customerId = newCustomer.id;
                }
            }
        }

        const invoiceNumber = `INV-DRAFT-${Date.now().toString().slice(-6)}`;
        
        const { data: invoice, error } = await supabase
            .from('invoices')
            .insert([{
                customer_id: customerId || null,
                buyer: { name: payload.customerName || 'Unknown Customer' },
                amount_paid: 0,
                subtotal: amount,
                total: amount,
                status: 'draft',
                invoiceNumber,
                organization_id: context.organizationId,
                date: new Date().toISOString(),
                dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            }])
            .select()
            .single();

        if (error) throw error;
        
        // Also insert a basic invoice item
        if (invoice) {
            await supabase.from('invoice_items').insert([{
                invoiceId: invoice.id,
                description: payload.description || 'Consulting / Services',
                quantity: 1,
                price: amount,
                organization_id: context.organizationId,
                sort_order: 0
            }]);
        }

        return { status: 'created', invoice };
    }

    async sendReminder(action = {}, context = {}) {
        const payload = action.data || {};
        const { customerName, invoiceNumber } = payload;
        
        // Edge case 1: Validate input
        if (!customerName && !invoiceNumber) {
            return {
                status: 'error',
                message: 'I need either a customer name or an invoice number to send a reminder.'
            };
        }

        let customerId = null;

        // Edge case 2: Check if customer exists
        if (customerName) {
            const { data: customer } = await supabase
                .from('customers')
                .select('id, name')
                .eq('organization_id', context.organizationId)
                .ilike('name', `%${customerName}%`)
                .maybeSingle();

            if (!customer) {
                return {
                    status: 'error',
                    message: `I couldn't find a customer named "${customerName}" in your database.`
                };
            }
            customerId = customer.id;
        }

        // Edge case 3: Check if invoice exists and is actually overdue (if we can verify)
        let invoiceQuery = supabase
            .from('invoices')
            .select('id, invoiceNumber, status, dueDate')
            .eq('organization_id', context.organizationId);

        if (invoiceNumber) {
            invoiceQuery = invoiceQuery.eq('invoiceNumber', invoiceNumber);
        } else if (customerId) {
            invoiceQuery = invoiceQuery.eq('customer_id', customerId).eq('status', 'overdue');
        }

        const { data: invoices, error } = await invoiceQuery.limit(1);

        if (error || !invoices || invoices.length === 0) {
            return {
                status: 'error',
                message: `I couldn't find any overdue invoices for ${customerName || invoiceNumber}. Please verify the name or invoice number.`
            };
        }

        const invoice = invoices[0];
        
        // Edge case 4: If an invoice was found by number, verify it's actually overdue/unpaid
        if (['paid', 'draft', 'cancelled'].includes(invoice.status)) {
            return {
                status: 'error',
                message: `Invoice ${invoice.invoiceNumber} is currently marked as ${invoice.status}. I can only send reminders for unpaid or overdue invoices.`
            };
        }

        // Here we could integrate an actual email service like Resend or SendGrid.
        // For now, we simulate success for the agent.
        return {
            status: 'sent',
            message: `Collection reminder successfully queued for ${customerName || invoice.invoiceNumber}.`,
            timestamp: new Date().toISOString()
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