-- Add missing columns to organization_configs for Settings page functionality
-- Run this migration to enable all organization settings fields

ALTER TABLE public.organization_configs 
ADD COLUMN IF NOT EXISTS default_gst_rate numeric(5,2) DEFAULT 18,
ADD COLUMN IF NOT EXISTS apply_gst_on_all_items boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS is_interstate boolean DEFAULT false;

-- Also add owner_name if not exists (used in frontend)
ALTER TABLE public.organization_configs
ADD COLUMN IF NOT EXISTS owner_name text;

-- Add freelance category fields
ALTER TABLE public.organization_configs
ADD COLUMN IF NOT EXISTS freelance_category text,
ADD COLUMN IF NOT EXISTS custom_freelance_category text,
ADD COLUMN IF NOT EXISTS daily_rate numeric(12,2),
ADD COLUMN IF NOT EXISTS is_gst_registered boolean DEFAULT false;
