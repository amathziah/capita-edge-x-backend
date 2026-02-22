-- Add is_inventory_tracked (default: false) and item_type (default: 'service')
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS is_inventory_tracked BOOLEAN DEFAULT false;

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'service';

-- Update existing rows to be 'physical' and 'tracked'
UPDATE public.products 
SET 
  is_inventory_tracked = true, 
  item_type = 'physical'
WHERE 
  is_inventory_tracked IS FALSE OR item_type IS NULL;
