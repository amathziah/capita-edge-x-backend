-- Migration: Create business_knowledge table
-- Author: Capita AI
-- Description: Stores business-specific knowledge like policies, FAQ, and about us.

CREATE TABLE IF NOT EXISTS business_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- e.g., 'policy', 'contact', 'about', 'faq'
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for organization and category
CREATE INDEX IF NOT EXISTS idx_business_knowledge_org_cat ON business_knowledge (organization_id, category);

-- Enable RLS
ALTER TABLE business_knowledge ENABLE ROW LEVEL SECURITY;

-- Add RLS policies (adjust as needed for user access)
CREATE POLICY "Allow members of organization to read business_knowledge"
    ON business_knowledge
    FOR SELECT
    USING (organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()));
