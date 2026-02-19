import { supabase } from '../supabase.js';
import ledgerService from '../services/ledgerService.js';
import { APIError } from '../middleware/errorHandler.js';

export const getPayments = async (req, res) => {
    const { data: payments, error } = await supabase
        .from('payments')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: false });

    if (error) throw new Error(error.message);
    res.json(payments);
};

export const createPayment = async (req, res) => {
    const { id, invoiceId, amount, date, method, notes, status } = req.body;

    // Insert payment
    const { data: payment, error } = await supabase
        .from('payments')
        .insert([{
            invoiceId, amount, date: date || new Date().toISOString(),
            method, notes, status: status || 'completed',
            organization_id: req.user.organizationId
        }])
        .select()
        .single();

    if (error) throw new Error(error.message);

    // Update invoice status if fully paid
    if (status === 'completed' || !status) { // Default is completed
        const { data: payments } = await supabase
            .from('payments')
            .select('amount')
            .eq('invoiceId', invoiceId)
            .eq('status', 'completed');

        const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

        const { data: invoice } = await supabase
            .from('invoices')
            .select('id, total, invoiceNumber, organization_id')
            .eq('id', invoiceId)
            .single();

        if (invoice) {
            // [LEDGER] Record the transaction
            await ledgerService.recordPayment(payment, invoice);

            if (totalPaid >= invoice.total) {
                await supabase
                    .from('invoices')
                    .update({ status: 'paid' })
                    .eq('id', invoiceId);
            }
        }
    }

    res.json({ success: true, id: payment.id });
};
