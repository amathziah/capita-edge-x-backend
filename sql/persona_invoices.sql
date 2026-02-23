-- ==========================================
-- PERSONA-SPECIFIC INVOICE FIELDS MIGRATION
-- ==========================================

-- 1. Add extra fields to the invoices table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='project_name') THEN
        ALTER TABLE public.invoices ADD COLUMN project_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='shipping_address') THEN
        ALTER TABLE public.invoices ADD COLUMN shipping_address TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='order_number') THEN
        ALTER TABLE public.invoices ADD COLUMN order_number TEXT;
    END IF;
END $$;

-- 2. Add extra fields to the invoice_items table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_items' AND column_name='service_start_date') THEN
        ALTER TABLE public.invoice_items ADD COLUMN service_start_date DATE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_items' AND column_name='service_end_date') THEN
        ALTER TABLE public.invoice_items ADD COLUMN service_end_date DATE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoice_items' AND column_name='sku') THEN
        ALTER TABLE public.invoice_items ADD COLUMN sku TEXT;
    END IF;
END $$;

-- 3. Update RLS policies if necessary (usually not needed if already enabled for the tables)
-- Policies for invoices and invoice_items usually use organization_id, which we already handle.
