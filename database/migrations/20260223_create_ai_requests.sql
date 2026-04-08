-- Migration to create ai_requests table for tracking AI usage and limits
CREATE TABLE IF NOT EXISTS ai_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    model_name TEXT,
    agent_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Organizations can view their own AI usage"
ON ai_requests FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM organization_users 
        WHERE organization_id = ai_requests.organization_id 
        AND user_id = auth.uid()
    )
);

-- System can insert (via Service Role or Admin Context)
-- In our case, the backend uses SUPABASE_SERVICE_ROLE_KEY to insert usage logs.
