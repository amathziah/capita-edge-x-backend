import { supabase } from '../../../core/database/supabase.js';
import emailService from '../../../core/services/email.service.js';
import pdfService from '../../invoices/pdf.service.js';

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
        let items = payload.items || [];
        let customerId = payload.customerId;
        let customerEmail = payload.customerEmail || null;
        let customerName = payload.customerName || null;
        let customerAddress = payload.customerAddress || null;
        
        if (!customerEmail || !customerAddress || !items || items.length === 0) {
            return {
                status: 'error',
                message: 'I need the customer\'s email, address, and the specific items/services to bill before I can create an invoice. Please provide these details.'
            };
        }
        
        let amount = Number(payload.amount || 0);
        if (amount <= 0 && items.length > 0) {
            amount = items.reduce((sum, item) => sum + (Number(item.quantity || 1) * Number(item.price || 0)), 0);
        }
        
        if (amount <= 0) {
            return {
                status: 'error',
                message: 'I cannot create an invoice for an amount of 0 or less. Please check the prices provided.'
            };
        }
        
        if (!customerId && (customerName || customerEmail)) {
            let existing = null;
            
            if (customerEmail) {
                 const { data } = await supabase.from('customers').select('id, name, email').eq('organization_id', context.organizationId).eq('email', customerEmail).maybeSingle();
                 existing = data;
            }
            if (!existing && customerName) {
                 const { data } = await supabase.from('customers').select('id, name, email').eq('organization_id', context.organizationId).ilike('name', `%${customerName}%`).maybeSingle();
                 existing = data;
            }
            
            if (existing) {
                customerId = existing.id;
                customerName = existing.name;
                customerEmail = customerEmail || existing.email || null;
            } else {
                const resolvedName = customerName || customerEmail?.split('@')[0] || 'Unknown Customer';
                return {
                    status: 'action_required',
                    type: 'open_customer_modal',
                    data: {
                        name: resolvedName,
                        email: customerEmail || '',
                        address: customerAddress || ''
                    },
                    message: `Before I can create an invoice for ${resolvedName}, you need to add them to your CRM. I've opened the Add Client form for you. Once saved, just ask me to create the invoice again!`
                };
            }
        }

        const invoiceNumber = `INV-DRAFT-${Date.now().toString().slice(-6)}`;
        
        // Build complete buyer object with email for preview and sending
        const buyer = {
            name: customerName || 'Unknown Customer',
            ...(customerEmail ? { email: customerEmail } : {}),
            ...(customerAddress ? { address: customerAddress } : {})
        };

        const { data: invoice, error } = await supabase
            .from('invoices')
            .insert([{
                customer_id: customerId || null,
                buyer,
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
        
        let enrichedItems = [];
        if (invoice && items.length > 0) {
            const itemsToInsert = items.map((it, idx) => ({
                invoiceId: invoice.id,
                description: it.description || 'Service',
                quantity: Number(it.quantity || 1),
                price: Number(it.price || amount),
                organization_id: context.organizationId,
                sort_order: idx
            }));
            const { data: insertedItems } = await supabase.from('invoice_items').insert(itemsToInsert).select();
            enrichedItems = insertedItems || [];
        } else if (invoice) {
            const { data: fallbackItems } = await supabase.from('invoice_items').insert([{
                invoiceId: invoice.id,
                description: payload.description || 'Consulting / Services',
                quantity: 1,
                price: amount,
                organization_id: context.organizationId,
                sort_order: 0
            }]).select();
            enrichedItems = fallbackItems || [];
        }

        // Parallel Lookups for speed
        const [orgResult, configResult] = await Promise.all([
            supabase.from('organizations').select('*').eq('id', context.organizationId).single(),
            supabase.from('organization_configs').select('owner_name, business_name, address, gstin, phone, email, upi_id, bank_name, bank_account_number, bank_ifsc, payment_qr_filename').eq('organization_id', context.organizationId).maybeSingle()
        ]);

        const org = orgResult.data;
        const orgSettings = configResult.data;

        return { 
            status: 'created', 
            message: 'Draft invoice created successfully.',
            invoice: { 
                ...invoice, 
                items: enrichedItems,
                organization: { ...(org || {}), ...(orgSettings || {}) }
            } 
        };
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

        // Use our EmailService which automatically checks for Google OAuth integration
        try {
            // Need buyer email from invoice. We only selected 'id, invoiceNumber, status, dueDate'
            // Let's refetch with buyer info.
            const { data: fullInvoice } = await supabase
                .from('invoices')
                .select('*, buyer')
                .eq('id', invoice.id)
                .single();
                
            const recipientEmail = fullInvoice?.buyer?.email;
            
            if (!recipientEmail) {
                 return {
                    status: 'error',
                    message: `Cannot send reminder. No email address found for customer ${customerName || invoice.invoiceNumber}.`
                };
            }
            
            await emailService.sendPaymentReminder(fullInvoice, recipientEmail, {
                organizationId: context.organizationId,
                businessName: 'Your Business' // Can be fetched from org later
            });
            
            return {
                status: 'sent',
                message: `Collection reminder successfully queued and sent to ${recipientEmail} for ${customerName || invoice.invoiceNumber}.`,
                timestamp: new Date().toISOString()
            };
        } catch (err) {
            console.error('AI Executor Email Error:', err);
            return {
                status: 'error',
                message: `Failed to send reminder for ${invoice.invoiceNumber}. Error: ${err.message}`
            };
        }
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