-- Add missing columns to organization_configs for Settings page functionality
-- Run this migration to enable all organization settings fields

ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS default_gst_rate numeric(5,2) DEFAULT 18,
ADD COLUMN IF NOT EXISTS apply_gst_on_all_items boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS is_interstate boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_gst_registered boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS owner_name text,
ADD COLUMN IF NOT EXISTS freelance_category text,
ADD COLUMN IF NOT EXISTS custom_freelance_category text,
ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2);

-- Set default values for existing rows
UPDATE public.organization_configs 
SET default_gst_rate = COALESCE(default_gst_rate, 18),
    apply_gst_on_all_items = COALESCE(apply_gst_on_all_items, true),
    is_interstate = COALESCE(is_interstate, false),
    is_gst_registered = COALESCE(is_gst_registered, false)
WHERE default_gst_rate IS NULL OR apply_gst_on_all_items IS NULL OR is_interstate IS NULL OR is_gst_registered IS NULL;
