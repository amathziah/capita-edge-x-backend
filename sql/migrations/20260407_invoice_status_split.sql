-- Split invoice lifecycle into document_status and payment_status.
-- Keeps legacy status for backward compatibility while backfilling CFO-grade fields.

ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS document_status text,
ADD COLUMN IF NOT EXISTS payment_status text,
ADD COLUMN IF NOT EXISTS balance_due numeric(14,2);

UPDATE public.invoices
SET
    document_status = CASE
        WHEN lower(coalesce(status, 'draft')) IN ('draft', 'awaiting_approval') THEN 'draft'
        WHEN lower(coalesce(status, 'draft')) IN ('void', 'cancelled') THEN 'void'
        WHEN lower(coalesce(status, 'draft')) IN ('write_off') THEN 'written_off'
        ELSE 'issued'
    END,
    payment_status = CASE
        WHEN coalesce(amount_paid, 0) >= coalesce(net_receivable, total, 0) THEN 'paid'
        WHEN coalesce(amount_paid, 0) > 0 THEN 'partially_paid'
        ELSE 'unpaid'
    END,
    balance_due = GREATEST(coalesce(net_receivable, total, 0) - coalesce(amount_paid, 0), 0)
WHERE document_status IS NULL
   OR payment_status IS NULL
   OR balance_due IS NULL;

ALTER TABLE public.invoices
ALTER COLUMN document_status SET DEFAULT 'draft',
ALTER COLUMN payment_status SET DEFAULT 'unpaid',
ALTER COLUMN balance_due SET DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoices_document_status_check'
    ) THEN
        ALTER TABLE public.invoices
        ADD CONSTRAINT invoices_document_status_check
        CHECK (document_status IN ('draft', 'issued', 'void', 'written_off'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoices_payment_status_check'
    ) THEN
        ALTER TABLE public.invoices
        ADD CONSTRAINT invoices_payment_status_check
        CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid'));
    END IF;
END $$;
