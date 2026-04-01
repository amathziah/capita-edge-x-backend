import { supabase } from '../../core/database/supabase.js';
import ledgerService from './ledger.service.js';
import fileService from '../../core/services/file.service.js';
import pdfService from '../invoices/pdf.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import { parsePagination } from '../../core/utils/pagination.js';

export const getPayments = async (req, res) => {
    let query = supabase
        .from('payments')
        .select('*', { count: 'exact' })
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: false });

    const { page, limit, offset } = parsePagination(req.query);
    query = query.range(offset, offset + limit - 1);

    const { data: payments, error, count } = await query;

    if (error) throw new Error(error.message);
    
    res.setHeader('X-Total-Count', count || 0);
    res.json(payments);
};

export const createPayment = async (req, res) => {
    const { id, invoiceId, amount, date, method, notes, status } = req.body;

        const rawMode = (req.body.paymentMode || req.body.method || 'other').toString().toLowerCase().trim();
        const validModes = ['upi', 'neft', 'imps', 'rtgs', 'cheque', 'cash', 'razorpay', 'stripe', 'other'];
        const paymentMode = validModes.includes(rawMode) ? rawMode : 'other';

        // Insert payment
        const { data: payment, error } = await supabase
            .from('payments')
            .insert([{
                invoiceId,
                amount,
                date: date || new Date().toISOString(),
                method,
                notes,
                status: status || 'completed',
                organization_id: req.user.organizationId,
                payment_mode: paymentMode,
                reference_number: req.body.referenceNumber || null,
                upi_transaction_id: req.body.upiTransactionId || null
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
            if (invoice.status === 'draft') {
                throw new Error('Cannot record payment for a draft invoice. Please send or view the invoice first.');
            }

            // [LEDGER] Record the transaction
            await ledgerService.recordPayment(payment, invoice);

            if (totalPaid >= invoice.total) {
                await supabase
                    .from('invoices')
                    .update({ status: 'paid' })
                    .eq('id', invoiceId);
            }

            // Trigger Capita client intelligence update
            if (invoice.customer_id) {
                supabase.rpc('update_customer_intelligence', {
                    p_customer_id: invoice.customer_id
                }).catch(err =>
                    console.error('Intelligence update failed:', err)
                );
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
    const { data: config } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    const settingsObj = mapConfigToFrontend(config);

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
        if (invoice.status === 'draft') {
            throw new Error('Cannot reconcile payment for a draft invoice.');
        }

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
