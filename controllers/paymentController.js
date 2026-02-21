import { supabase } from '../supabase.js';
import ledgerService from '../services/ledgerService.js';
import fileService from '../services/fileService.js';
import pdfService from '../services/pdfService.js';
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
export const downloadReceipt = async (req, res) => {
    const { paymentId } = req.params;

    const { data: payment, error: pError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (pError || !payment) throw new APIError('Payment not found', 404);

    const { data: invoice, error: iError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', payment.invoiceId)
        .single();

    if (iError || !invoice) throw new APIError('Linked invoice not found', 404);

    // Get settings for branding
    const { data: settingsObj } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    // Add path for logo
    if (settingsObj?.logo_filename) settingsObj.logoPath = fileService.getFilePath(settingsObj.logo_filename);

    let tempPath = null;
    try {
        tempPath = pdfService.getTempReceiptPath(payment.id);
        await pdfService.generateReceiptPDF(payment, invoice, settingsObj, tempPath);

        res.download(tempPath, `receipt_${invoice.invoiceNumber}.pdf`, (err) => {
            if (err) console.error('Download error:', err);
            pdfService.cleanupPDF(tempPath);
        });
    } catch (err) {
        if (tempPath) pdfService.cleanupPDF(tempPath);
        throw new APIError(err.message, 500);
    }
};

export const reconcilePayment = async (req, res) => {
    const { id } = req.params;

    const { data: payment, error } = await supabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', id)
        .eq('organization_id', req.user.organizationId)
        .select()
        .single();

    if (error || !payment) throw new APIError('Payment not found or already reconciled', 404);

    // Update invoice status if fully paid
    const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('invoiceId', payment.invoiceId)
        .eq('status', 'completed');

    const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

    const { data: invoice } = await supabase
        .from('invoices')
        .select('id, total, invoiceNumber, organization_id')
        .eq('id', payment.invoiceId)
        .single();

    if (invoice) {
        // [LEDGER] Record the transaction
        await ledgerService.recordPayment(payment, invoice);

        if (totalPaid >= invoice.total) {
            await supabase
                .from('invoices')
                .update({ status: 'paid' })
                .eq('id', payment.invoiceId);
        }
    }

    res.json({ success: true, payment });
};
