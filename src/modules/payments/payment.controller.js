import { supabase } from '../../core/database/supabase.js';
import ledgerService from './ledger.service.js';
import fileService from '../../core/services/file.service.js';
import pdfService from '../invoices/pdf.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import { parsePagination } from '../../core/utils/pagination.js';
import {
    getInvoiceAmounts,
    normalizeStoredInvoiceStatus,
    resolveDocumentStatus,
    resolvePaymentStatus,
    resolveStoredStatusForPersistence
} from '../invoices/invoiceStatus.service.js';

const UI_PAYMENT_MODES = ['upi', 'neft', 'imps', 'rtgs', 'cheque', 'cash', 'card', 'bank_transfer', 'razorpay', 'stripe', 'other'];
const DB_PAYMENT_MODE_MAP = {
    bank_transfer: 'neft',
    card: 'other'
};
const SETTLEMENT_SCHEMA_COLUMNS = ['balance_due', 'document_status', 'payment_status'];

const getDbSafePaymentMode = (rawMode) => DB_PAYMENT_MODE_MAP[rawMode] || rawMode;
const isMissingSettlementColumnError = (error) =>
    Boolean(error?.message) &&
    SETTLEMENT_SCHEMA_COLUMNS.some((column) => error.message.includes(column));

const updateInvoicePaymentState = async ({ invoiceId, organizationId, invoiceWithPayments, totalPaid }) => {
    const { balanceDue: updatedBalanceDue } = getInvoiceAmounts(invoiceWithPayments);
    const fullUpdate = {
        amount_paid: totalPaid,
        balance_due: updatedBalanceDue,
        document_status: resolveDocumentStatus(invoiceWithPayments),
        payment_status: resolvePaymentStatus(invoiceWithPayments),
        status: resolveStoredStatusForPersistence(invoiceWithPayments),
        updatedAt: new Date().toISOString()
    };

    const fullResult = await supabase
        .from('invoices')
        .update(fullUpdate)
        .eq('id', invoiceId)
        .eq('organization_id', organizationId);

    if (!fullResult.error) {
        return;
    }

    if (!isMissingSettlementColumnError(fullResult.error)) {
        throw new APIError(fullResult.error.message, 500);
    }

    const fallbackResult = await supabase
        .from('invoices')
        .update({
            amount_paid: totalPaid,
            status: resolveStoredStatusForPersistence(invoiceWithPayments),
            updatedAt: new Date().toISOString()
        })
        .eq('id', invoiceId)
        .eq('organization_id', organizationId);

    if (fallbackResult.error) {
        throw new APIError(fallbackResult.error.message, 500);
    }
};

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
    const {
        invoiceId,
        amount: rawAmount,
        date,
        notes,
        status
    } = req.body;

    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new APIError('Payment amount must be greater than zero', 400);
    }

    const { data: invoiceForPayment, error: invoiceLookupError } = await supabase
        .from('invoices')
        .select('id, total, net_receivable, amount_paid, status, customer_id, invoiceNumber, organization_id')
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (invoiceLookupError || !invoiceForPayment) {
        throw new APIError('Invoice not found', 404);
    }

    if (normalizeStoredInvoiceStatus(invoiceForPayment.status) === 'draft') {
        throw new APIError('Cannot record payment for a draft invoice. Please send or view the invoice first.', 400);
    }

    const { balanceDue } = getInvoiceAmounts(invoiceForPayment);
    if (balanceDue <= 0) {
        throw new APIError('This invoice is already fully paid.', 400);
    }
    if (amount - balanceDue > 0.009) {
        throw new APIError(`Payment exceeds the remaining balance of ${balanceDue.toFixed(2)}.`, 400);
    }

    const rawMode = (req.body.paymentMode || req.body.method || 'other').toString().toLowerCase().trim();
    const paymentMethod = UI_PAYMENT_MODES.includes(rawMode) ? rawMode : 'other';
    const paymentMode = getDbSafePaymentMode(paymentMethod);
    const normalizedStatus = (status || 'completed').toString().toLowerCase().trim();

    const { data: payment, error } = await supabase
        .from('payments')
        .insert([{
            invoiceId,
            amount,
            date: date || new Date().toISOString(),
            method: paymentMethod,
            notes,
            status: normalizedStatus,
            organization_id: req.user.organizationId,
            payment_mode: paymentMode,
            reference_number: req.body.referenceNumber || null,
            upi_transaction_id: req.body.upiTransactionId || null
        }])
        .select()
        .single();

    if (error) throw new Error(error.message);

    // Update invoice status if fully paid
    if (normalizedStatus === 'completed') {
        const { data: payments } = await supabase
            .from('payments')
            .select('amount')
            .eq('invoiceId', invoiceId)
            .eq('status', 'completed');

        const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

        const invoice = invoiceForPayment;

        if (invoice) {
            // [LEDGER] Record the transaction
            await ledgerService.recordPayment(payment, invoice);

            const invoiceWithPayments = { ...invoice, amount_paid: totalPaid };
            await updateInvoicePaymentState({
                invoiceId,
                organizationId: req.user.organizationId,
                invoiceWithPayments,
                totalPaid
            });

            // Trigger Capita client intelligence update
            if (invoice.customer_id) {
                void (async () => {
                    const { error: intelligenceError } = await supabase.rpc('update_customer_intelligence', {
                        p_customer_id: invoice.customer_id
                    });
                    if (intelligenceError) {
                        console.error('Intelligence update failed:', intelligenceError);
                    }
                })();
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
        .eq('organization_id', req.user.organizationId)
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
        .select('id, total, net_receivable, amount_paid, status, customer_id, invoiceNumber, organization_id')
        .eq('id', payment.invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (invoice) {
        if (normalizeStoredInvoiceStatus(invoice.status) === 'draft') {
            throw new Error('Cannot reconcile payment for a draft invoice.');
        }

        // [LEDGER] Record the transaction
        await ledgerService.recordPayment(payment, invoice);

        const invoiceWithPayments = { ...invoice, amount_paid: totalPaid };
        await updateInvoicePaymentState({
            invoiceId: payment.invoiceId,
            organizationId: req.user.organizationId,
            invoiceWithPayments,
            totalPaid
        });
    }

    res.json({ success: true, payment });
};
