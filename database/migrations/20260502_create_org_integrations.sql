-- Migration: Create organization integrations table
-- Description: Stores OAuth tokens (e.g., Google/Gmail) for organizations securely

CREATE TABLE IF NOT EXISTS public.organization_integrations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- e.g., 'google'
    access_token TEXT,
    refresh_token TEXT,
    metadata JSONB DEFAULT '{}'::jsonb, -- Store connected email address, scope, expiry, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, provider)
);

-- Enable RLS
ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their organization's integrations
CREATE POLICY "Users can view their organization's integrations"
    ON public.organization_integrations
    FOR SELECT
    USING (organization_id IN (
        SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid()
    ));

-- Policy: Only admins/owners can modify their organization's integrations
CREATE POLICY "Users can insert their organization's integrations"
    ON public.organization_integrations
    FOR INSERT
    WITH CHECK (organization_id IN (
        SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update their organization's integrations"
    ON public.organization_integrations
    FOR UPDATE
    USING (organization_id IN (
        SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can delete their organization's integrations"
    ON public.organization_integrations
    FOR DELETE
    USING (organization_id IN (
        SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid()
    ));

-- Create the function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update 'updated_at'
CREATE TRIGGER update_organization_integrations_updated_at
    BEFORE UPDATE ON public.organization_integrations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
