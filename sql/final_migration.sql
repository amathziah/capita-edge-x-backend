-- ==========================================
-- FINAL SECURE ARCHITECTURE MIGRATION
-- ==========================================

-- 1. Enable Supabase Vault
CREATE EXTENSION IF NOT EXISTS "supabase_vault" CASCADE;

-- 2. Create organization_configs (Columnar Storage)
-- This replaces the legacy EAV (Key-Value) settings table
CREATE TABLE IF NOT EXISTS public.organization_configs (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    business_name text,
    company_tax_id text,
    email text,
    phone text,
    address text,
    payment_terms text,
    footer_text text,
    invoice_notes text,
    upi_id text,
    bank_details text,
    payment_instructions text,
    currency text DEFAULT 'INR',
    tax_label text DEFAULT 'GST',
    invoice_prefix text DEFAULT 'INV-',
    logo_filename text,
    smtp_user text,
    inventory_settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamptz DEFAULT now()
);

-- 3. Chart of Accounts Foundation
CREATE TABLE IF NOT EXISTS public.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    name text NOT NULL,
    account_type text CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    created_at timestamptz DEFAULT now()
);

-- 4. Update Ledger Entries to use UUID accounts
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ledger_entries' AND column_name='account_id') THEN
        ALTER TABLE public.ledger_entries ADD COLUMN account_id uuid REFERENCES public.accounts(id);
    END IF;
END $$;

-- 5. Invoice Sharing & PDF Schema
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='share_token') THEN
        ALTER TABLE public.invoices ADD COLUMN share_token text UNIQUE DEFAULT gen_random_uuid()::text;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invoices' AND column_name='pdf_url') THEN
        ALTER TABLE public.invoices ADD COLUMN pdf_url text;
    END IF;
END $$;

-- 6. RPC Helpers for Vault
CREATE OR REPLACE FUNCTION set_organization_secret(p_organization_id uuid, p_name text, p_secret text)
RETURNS void AS $$
BEGIN
  INSERT INTO vault.secrets (name, secret, description)
  VALUES (p_organization_id || ':' || p_name, p_secret, 'Org Secret')
  ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_organization_secret(p_organization_id uuid, p_name text)
RETURNS text AS $$
DECLARE
  secret_val text;
BEGIN
  SELECT secret FROM vault.secrets WHERE name = p_organization_id || ':' || p_name INTO secret_val;
  RETURN secret_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. CLEANUP: Drop legacy settings table
-- WARNING: Ensure you have manually migrated data if needed before running this in production
-- DROP TABLE IF EXISTS public.settings;
