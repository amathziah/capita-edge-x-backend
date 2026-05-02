-- ==========================================
-- ADD MISSING CONFIGURATION COLUMNS
-- ==========================================

-- Add identity and tax fields
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS owner_name text,
ADD COLUMN IF NOT EXISTS gstin text,
ADD COLUMN IF NOT EXISTS pan text,
ADD COLUMN IF NOT EXISTS frn text,
ADD COLUMN IF NOT EXISTS state text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS pincode text,
ADD COLUMN IF NOT EXISTS msme_number text,
ADD COLUMN IF NOT EXISTS lut_number text;

-- Add bank details fields (Standardized)
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS bank_name text,
ADD COLUMN IF NOT EXISTS bank_account_number text,
ADD COLUMN IF NOT EXISTS bank_ifsc text;

-- Add business and invoice behavior fields
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'solopreneur',
ADD COLUMN IF NOT EXISTS default_due_days integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS default_gst_rate numeric DEFAULT 18,
ADD COLUMN IF NOT EXISTS apply_gst_on_all_items boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS is_interstate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS freelance_category text,
ADD COLUMN IF NOT EXISTS custom_freelance_category text,
ADD COLUMN IF NOT EXISTS daily_rate numeric,
ADD COLUMN IF NOT EXISTS is_gst_registered boolean DEFAULT false;

-- Add automated follow-up fields
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS auto_follow_up boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS follow_up_day_1 integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS follow_up_day_2 integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS follow_up_day_3 integer DEFAULT 7;

-- Add inventory and alert fields
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS dead_stock_threshold_days integer DEFAULT 90,
ADD COLUMN IF NOT EXISTS reorder_alerts_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS mrr_alerts_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS weekly_summary_enabled boolean DEFAULT true;

-- Add payment_qr_filename if missing
ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS payment_qr_filename text;
