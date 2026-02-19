import { supabase } from '../supabase.js';

class LedgerService {
    /**
     * Record an Invoice (Debit AR, Credit Revenue)
     * @param {Object} invoice 
     */
    async recordInvoice(invoice) {
        if (invoice.status === 'draft') return; // Only record committed invoices

        const organizationId = invoice.organization_id;
        const transactionId = crypto.randomUUID();

        // DEBIT: Accounts Receivable (Asset)
        const drEntry = {
            organization_id: organizationId,
            "transactionId": transactionId,
            "accountType": 'asset',
            "accountName": 'Accounts Receivable',
            description: `Invoice #${invoice.invoiceNumber}`,
            debit: invoice.total,
            credit: 0,
            date: new Date().toISOString(),
            "referenceId": invoice.id,
            "referenceType": 'invoice'
        };

        // CREDIT: Sales Revenue (Revenue)
        const crEntry = {
            organization_id: organizationId,
            "transactionId": transactionId,
            "accountType": 'revenue',
            "accountName": 'Sales Revenue',
            description: `Invoice #${invoice.invoiceNumber}`,
            debit: 0,
            credit: invoice.total,
            date: new Date().toISOString(),
            "referenceId": invoice.id,
            "referenceType": 'invoice'
        };

        const { error } = await supabase.from('ledger_entries').insert([drEntry, crEntry]);
        if (error) console.error('Ledger Error (Invoice):', error);
    }

    /**
     * Record a Payment (Debit Cash, Credit AR)
     * @param {Object} payment 
     * @param {Object} invoice 
     */
    async recordPayment(payment, invoice) {
        const organizationId = payment.organization_id;
        const transactionId = crypto.randomUUID();

        // DEBIT: Bank/Cash (Asset)
        const drEntry = {
            organization_id: organizationId,
            "transactionId": transactionId,
            "accountType": 'asset',
            "accountName": payment.method === 'cash' ? 'Cash on Hand' : 'Bank',
            description: `Payment for #${invoice.invoiceNumber}`,
            debit: payment.amount,
            credit: 0,
            date: new Date().toISOString(),
            "referenceId": payment.id,
            "referenceType": 'payment'
        };

        // CREDIT: Accounts Receivable (Asset) - Reducing the asset
        const crEntry = {
            organization_id: organizationId,
            "transactionId": transactionId,
            "accountType": 'asset',
            "accountName": 'Accounts Receivable',
            description: `Payment for #${invoice.invoiceNumber}`,
            debit: 0,
            credit: payment.amount,
            date: new Date().toISOString(),
            "referenceId": payment.id,
            "referenceType": 'payment'
        };

        const { error } = await supabase.from('ledger_entries').insert([drEntry, crEntry]);
        if (error) console.error('Ledger Error (Payment):', error);
    }
}

export default new LedgerService();
