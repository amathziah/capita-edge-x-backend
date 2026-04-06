ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS shared_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS share_revoked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_share_expires_at
ON public.invoices (share_expires_at)
WHERE share_token IS NOT NULL;
