-- ==========================================
-- ATOMIC INVOICE NUMBER GENERATION
-- ==========================================

-- 1. Create a table to track sequences per organization
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    last_number integer DEFAULT 0,
    updated_at timestamptz DEFAULT now()
);

-- 2. Create the atomic generator function
CREATE OR REPLACE FUNCTION generate_next_invoice_number(p_organization_id uuid)
RETURNS text AS $$
DECLARE
    v_last_num integer;
    v_next_num text;
BEGIN
    -- Atomic upsert and locking
    INSERT INTO public.invoice_sequences (organization_id, last_number)
    VALUES (p_organization_id, 1)
    ON CONFLICT (organization_id) 
    DO UPDATE SET 
        last_number = public.invoice_sequences.last_number + 1,
        updated_at = now()
    RETURNING last_number INTO v_last_num;

    v_next_num := 'INV-' || lpad(v_last_num::text, 4, '0');
    RETURN v_next_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Pre-seed sequences from existing invoices (Optional but recommended)
INSERT INTO public.invoice_sequences (organization_id, last_number)
SELECT organization_id, MAX(substring("invoiceNumber" FROM 'INV-(\d+)')::integer)
FROM public.invoices
WHERE "invoiceNumber" LIKE 'INV-%'
GROUP BY organization_id
ON CONFLICT (organization_id) DO UPDATE SET last_number = EXCLUDED.last_number;
