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
        const amount = Number(payload.amount || 0);
        
        if (amount <= 0) {
            return {
                status: 'error',
                message: 'I cannot create an invoice for an amount of 0 or less. Please provide a valid amount.'
            };
        }

        let customerId = payload.customerId;
        
        if (!customerId && (payload.customerName || payload.customerEmail)) {
            let existing = null;
            
            if (payload.customerEmail) {
                 const { data } = await supabase.from('customers').select('id, name').eq('organization_id', context.organizationId).eq('email', payload.customerEmail).maybeSingle();
                 existing = data;
            }
            if (!existing && payload.customerName) {
                 const { data } = await supabase.from('customers').select('id, name').eq('organization_id', context.organizationId).ilike('name', `%${payload.customerName}%`).maybeSingle();
                 existing = data;
            }
            
            if (existing) {
                customerId = existing.id;
                payload.customerName = existing.name;
            } else {
                const { data: newCustomer } = await supabase
                    .from('customers')
                    .insert([{
                        name: payload.customerName || payload.customerEmail?.split('@')[0] || 'Unknown Customer',
                        email: payload.customerEmail || null,
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
        let enrichedItems = [];
        if (invoice) {
            const { data: items } = await supabase.from('invoice_items').insert([{
                invoiceId: invoice.id,
                description: payload.description || 'Consulting / Services',
                quantity: 1,
                price: amount,
                organization_id: context.organizationId,
                sort_order: 0
            }]).select();
            enrichedItems = items || [];
        }

        // Fetch org + settings for "Billed From" preview
        const { data: org } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', context.organizationId)
            .single();

        const { data: orgSettings } = await supabase
            .from('organization_configs')
            .select('owner_name, business_name, address, gstin, phone, email, upi_id, bank_name, bank_account_number, bank_ifsc')
            .eq('organization_id', context.organizationId)
            .maybeSingle();

        // Check for Google Integration if sendImmediately is true
        let hasGoogleIntegration = false;
        if (payload.sendImmediately) {
            const { data: integration } = await supabase
                .from('organization_integrations')
                .select('id')
                .eq('organization_id', context.organizationId)
                .in('provider', ['google', 'google_gmail'])
                .maybeSingle();
            hasGoogleIntegration = !!integration;
        }

        let message = 'Draft invoice created successfully.';
        if (payload.sendImmediately && (payload.customerEmail || customerId)) {
            try {
                // ── Google Integration Gate ─────────────────────────────────
                if (!hasGoogleIntegration) {
                    return {
                        status: 'blocked',
                        message: `⚠️ Invoice created as draft (INV: ${invoiceNumber}), but could not be sent. You haven't connected your Gmail account yet. Please go to **Settings → Integrations** and connect Google to enable automated invoice dispatch.`
                    };
                }

                // ── Payment Details Gate ─────────────────────────────────────
                // Block sending if the org hasn't completed payment onboarding.
                // A customer receiving an invoice must have a way to pay.
                const hasUpi = Boolean(orgSettings?.upi_id);
                const hasBankDetails = Boolean(orgSettings?.bank_name && orgSettings?.bank_account_number && orgSettings?.bank_ifsc);

                if (!hasUpi && !hasBankDetails) {
                    return {
                        status: 'blocked',
                        message: `⚠️ Invoice created as draft (INV: ${invoiceNumber}), but could not be sent. Your payment details are incomplete — the customer would have no way to pay. Please go to **Settings → Invoicing & Payments** and add your bank account or UPI ID first, then send the invoice manually.`
                    };
                }
                // ────────────────────────────────────────────────────────────

                // Fetch customer email if we only have ID
                let targetEmail = payload.customerEmail;
                if (!targetEmail && customerId) {
                    const { data: cust } = await supabase.from('customers').select('email').eq('id', customerId).single();
                    targetEmail = cust?.email;
                }
                
                if (targetEmail) {

                    // Build full invoice object with items for PDF rendering
                    const invoiceForPdf = {
                        ...invoice,
                        items: enrichedItems,
                        buyer: { name: payload.customerName || 'Customer', email: targetEmail }
                    };

                    // Generate PDF in-memory (no temp file)
                    let pdfBuffer = null;
                    try {
                        pdfBuffer = await pdfService.generateInvoicePDFBuffer(invoiceForPdf, orgSettings || {});
                    } catch (pdfErr) {
                        console.error('PDF buffer generation failed:', pdfErr);
                    }

                    await emailService.sendInvoice(
                        invoiceForPdf,
                        pdfBuffer,
                        targetEmail,
                        { organizationId: context.organizationId, ...(orgSettings || {}) }
                    );

                    // Update status to sent
                    await supabase.from('invoices').update({ status: 'sent' }).eq('id', invoice.id);
                    invoice.status = 'sent';
                    message = `Invoice created and sent to ${targetEmail}.`;
                } else {
                    message = 'Invoice created as draft (no email address found).';
                }
            } catch (e) {
                console.error('Error sending invoice immediately:', e);
                if (e.message?.includes('authentication failed') || e.code === 'EAUTH') {
                    message = 'Invoice drafted, but Gmail authentication failed. Your connection might have expired. Please re-connect Google in Settings.';
                } else {
                    message = `Invoice drafted, but email delivery failed: ${e.message || 'Unknown error'}`;
                }
            }
        }

        return { 
            status: 'created', 
            message,
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