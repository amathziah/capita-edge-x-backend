const LEGACY_TO_CANONICAL_STATUS = {
    pending: 'sent',
    overdue: 'sent',
    cancelled: 'void',
    viewed: 'sent',
    approved: 'sent',
    awaiting_approval: 'draft'
};

export const normalizeStoredInvoiceStatus = (status = 'draft') => {
    const normalized = String(status || 'draft').toLowerCase().trim();
    return LEGACY_TO_CANONICAL_STATUS[normalized] || normalized;
};

export const getInvoiceAmounts = (invoice = {}) => {
    const totalAmount = Number(invoice.net_receivable ?? invoice.netReceivable ?? invoice.total ?? 0);
    const totalPaid = Number(invoice.amount_paid ?? invoice.amountPaid ?? 0);
    const persistedBalanceDue = invoice.balance_due ?? invoice.balanceDue;
    const balanceDue = persistedBalanceDue !== undefined
        ? Math.max(Number(persistedBalanceDue || 0), 0)
        : Math.max(totalAmount - totalPaid, 0);

    return { totalAmount, totalPaid, balanceDue };
};

export const resolveDocumentStatus = (invoice = {}) => {
    const explicit = invoice.document_status || invoice.documentStatus;
    if (explicit) {
        const normalized = String(explicit).toLowerCase().trim();
        if (['draft', 'issued', 'void', 'written_off'].includes(normalized)) {
            return normalized;
        }
    }

    const baseStatus = normalizeStoredInvoiceStatus(invoice.status);
    if (baseStatus === 'draft') return 'draft';
    if (baseStatus === 'void') return 'void';
    if (baseStatus === 'write_off') return 'written_off';
    return 'issued';
};

export const resolvePaymentStatus = (invoice = {}) => {
    const explicit = invoice.payment_status || invoice.paymentStatus;
    if (explicit) {
        const normalized = String(explicit).toLowerCase().trim();
        if (['unpaid', 'partially_paid', 'paid'].includes(normalized)) {
            return normalized;
        }
    }

    const documentStatus = resolveDocumentStatus(invoice);
    if (documentStatus === 'draft' || documentStatus === 'void' || documentStatus === 'written_off') {
        return 'unpaid';
    }

    const { totalAmount, totalPaid, balanceDue } = getInvoiceAmounts(invoice);
    if (totalAmount <= 0 || balanceDue <= 0) return 'paid';
    if (totalPaid > 0) return 'partially_paid';
    return 'unpaid';
};

export const resolveCollectionStatus = (invoice = {}) => {
    const documentStatus = resolveDocumentStatus(invoice);
    const paymentStatus = resolvePaymentStatus(invoice);

    if (documentStatus !== 'issued' || paymentStatus === 'paid') {
        return 'closed';
    }

    const dueDate = invoice.dueDate || invoice.due_date || invoice.date || invoice.issue_date;
    if (!dueDate) return 'current';

    const todayStr = new Date().toISOString().split('T')[0];
    const dueStr = new Date(dueDate).toISOString().split('T')[0];
    if (dueStr < todayStr) return 'overdue';
    if (dueStr === todayStr) return 'due_today';
    return 'current';
};

export const getDaysOverdue = (invoice = {}) => {
    if (resolveCollectionStatus(invoice) !== 'overdue') return 0;
    const dueDate = invoice.dueDate || invoice.due_date || invoice.date || invoice.issue_date;
    if (!dueDate) return 0;
    const diff = Date.now() - new Date(dueDate).getTime();
    return Math.max(Math.floor(diff / 86400000), 0);
};

export const resolveInvoiceStatus = (invoice = {}) => {
    const documentStatus = resolveDocumentStatus(invoice);
    const paymentStatus = resolvePaymentStatus(invoice);
    const collectionStatus = resolveCollectionStatus(invoice);

    if (documentStatus === 'draft') return 'draft';
    if (documentStatus === 'void') return 'void';
    if (documentStatus === 'written_off') return 'write_off';
    if (paymentStatus === 'paid') return 'paid';
    if (collectionStatus === 'overdue') return 'overdue';
    if (paymentStatus === 'partially_paid') return 'partially_paid';
    return 'sent';
};

export const resolveStoredStatusForPersistence = (invoice = {}) => {
    const baseStatus = normalizeStoredInvoiceStatus(invoice.status);
    if (baseStatus === 'draft' || baseStatus === 'void' || baseStatus === 'write_off') {
        return baseStatus;
    }

    const { totalAmount, totalPaid, balanceDue } = getInvoiceAmounts(invoice);
    if (totalAmount <= 0 || balanceDue <= 0) return 'paid';
    if (totalPaid > 0) return 'partially_paid';
    return 'sent';
};

export const attachResolvedInvoiceStatus = (invoice = {}) => ({
    ...invoice,
    status: resolveInvoiceStatus(invoice),
    document_status: resolveDocumentStatus(invoice),
    payment_status: resolvePaymentStatus(invoice),
    collection_status: resolveCollectionStatus(invoice),
    balance_due: getInvoiceAmounts(invoice).balanceDue,
    days_overdue: getDaysOverdue(invoice)
});

export const isCollectibleInvoice = (invoice = {}) => {
    const status = resolveInvoiceStatus(invoice);
    return status === 'sent' || status === 'partially_paid' || status === 'overdue';
};
