-- ==========================================
-- INVENTORY FORECASTING RPC
-- ==========================================

-- Function to calculate 30-day sales velocity and last sold date for all products
-- This allows the Inventory Intelligence engine to predict stockouts and dead stock.

-- Ensure status column exists
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active';

CREATE OR REPLACE FUNCTION public.calculate_inventory_forecast()
RETURNS void AS $$
BEGIN
    -- Update sales velocity (units per day) and last sold date
    UPDATE public.products p
    SET 
        sales_velocity_30d = COALESCE(
            (
                SELECT (SUM(ii.quantity)::numeric / 30.0)
                FROM public.invoice_items ii
                JOIN public.invoices i ON i.id = ii."invoiceId"
                WHERE ii."productId" = p.id
                AND i.date >= (CURRENT_DATE - INTERVAL '30 days')
                AND i.status = 'paid'
            ), 
            0
        ),
        last_sold_at = (
            SELECT MAX(i.date)
            FROM public.invoice_items ii
            JOIN public.invoices i ON i.id = ii."invoiceId"
            WHERE ii."productId" = p.id
            AND i.status = 'paid'
        )
    WHERE p.id IS NOT NULL; -- Ensure a WHERE clause is present to satisfy strict environments
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
