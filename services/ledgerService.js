import { supabase } from '../supabase.js';

class LedgerService {
    /**
     * Helper to resolve account name to ID for an organization
     */
    async getAccountId(orgId, accountName, accountType) {
        const { data, error } = await supabase
            .from('accounts')
            .select('id')
            .eq('organization_id', orgId)
            .eq('name', accountName)
            .single();

        if (error || !data) {
            // Fallback: Create the account if it's missing (shouldn't happen with provisioning)
            const { data: newAcc, error: createError } = await supabase
                .from('accounts')
                .insert([{ organization_id: orgId, name: accountName, account_type: accountType }])
                .select()
                .single();

            if (createError) return null;
            return newAcc.id;
        }

        return data.id;
    }

    /**
     * Record an Invoice (Debit AR, Credit Revenue)
     * @param {Object} invoice 
     */
    async recordInvoice(invoice) {
        if (invoice.status === 'draft') return;

        const organizationId = invoice.organization_id;
        const transactionId = crypto.randomUUID();

        const arId = await this.getAccountId(organizationId, 'Accounts Receivable', 'asset');
        const revenueId = await this.getAccountId(organizationId, 'Sales Revenue', 'revenue');

        // DEBIT: Accounts Receivable (Asset)
        const drEntry = {
            organization_id: organizationId,
            account_id: arId,
            transactionId: transactionId,
            accountType: 'asset',
            accountName: 'Accounts Receivable',
            description: `Invoice #${invoice.invoiceNumber}`,
            debit: invoice.total,
            credit: 0,
            date: new Date().toISOString(),
            referenceId: invoice.id,
            referenceType: 'invoice'
        };

        // CREDIT: Sales Revenue (Revenue)
        const crEntry = {
            organization_id: organizationId,
            account_id: revenueId,
            transactionId: transactionId,
            accountType: 'revenue',
            accountName: 'Sales Revenue',
            description: `Invoice #${invoice.invoiceNumber}`,
            debit: 0,
            credit: invoice.total,
            date: new Date().toISOString(),
            referenceId: invoice.id,
            referenceType: 'invoice'
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

        const cashAccountName = payment.method === 'cash' ? 'Cash on Hand' : 'Bank';
        const bankId = await this.getAccountId(organizationId, cashAccountName, 'asset');
        const arId = await this.getAccountId(organizationId, 'Accounts Receivable', 'asset');

        // DEBIT: Bank/Cash (Asset)
        const drEntry = {
            organization_id: organizationId,
            account_id: bankId,
            transactionId: transactionId,
            accountType: 'asset',
            accountName: cashAccountName,
            description: `Payment for #${invoice.invoiceNumber}`,
            debit: payment.amount,
            credit: 0,
            date: new Date().toISOString(),
            referenceId: payment.id,
            referenceType: 'payment'
        };

        // CREDIT: Accounts Receivable (Asset)
        const crEntry = {
            organization_id: organizationId,
            account_id: arId,
            transactionId: transactionId,
            accountType: 'asset',
            accountName: 'Accounts Receivable',
            description: `Payment for #${invoice.invoiceNumber}`,
            debit: 0,
            credit: payment.amount,
            date: new Date().toISOString(),
            referenceId: payment.id,
            referenceType: 'payment'
        };

        const { error } = await supabase.from('ledger_entries').insert([drEntry, crEntry]);
        if (error) console.error('Ledger Error (Payment):', error);
    }
}

export default new LedgerService();
