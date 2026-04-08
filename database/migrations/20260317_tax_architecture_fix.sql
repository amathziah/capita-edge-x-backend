-- Migration 1: tds_section on invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tds_section text DEFAULT '194J';

-- Migration 2: round_off on invoices  
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS round_off numeric DEFAULT 0;

-- Migration 3: is_exempt on invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS is_exempt boolean DEFAULT false;

-- Migration 4: discount_type on invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'percentage';

-- Migration 5: state on customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS state text;

-- Migration 6: advance_tax_ledger table
CREATE TABLE IF NOT EXISTS public.advance_tax_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  financial_year  text NOT NULL,
  instalment      integer NOT NULL,
  due_date        date NOT NULL,
  amount_paid     numeric DEFAULT 0,
  paid_on         date,
  challan_number  text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(organization_id, financial_year, instalment)
);

ALTER TABLE public.advance_tax_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "org_isolation_advance_tax"
  ON public.advance_tax_ledger
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_users
      WHERE user_id = auth.uid()
    )
  );
