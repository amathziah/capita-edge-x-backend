-- Create platform_reports table for user feedback and error reporting
CREATE TABLE IF NOT EXISTS platform_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('bug', 'feature_request', 'feedback', 'ui_issue')),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE platform_reports ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can create reports for their organization"
ON platform_reports FOR INSERT
WITH CHECK (
    auth.uid() = user_id AND 
    EXISTS (
        SELECT 1 FROM organization_users 
        WHERE organization_id = platform_reports.organization_id 
        AND user_id = auth.uid()
    )
);

CREATE POLICY "Users can view their own organization's reports"
ON platform_reports FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM organization_users 
        WHERE organization_id = platform_reports.organization_id 
        AND user_id = auth.uid()
    )
);
