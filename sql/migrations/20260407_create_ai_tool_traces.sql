-- Persistent trace log for AI orchestration plans, tool executions, and final responses
CREATE TABLE IF NOT EXISTS ai_tool_traces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trace_id UUID NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    conversation_id UUID NULL,
    stage TEXT NOT NULL CHECK (stage IN ('plan', 'tool', 'final', 'error')),
    tool_id TEXT NULL,
    query TEXT NULL,
    input JSONB DEFAULT '{}'::jsonb NOT NULL,
    output JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_traces_trace_id
ON ai_tool_traces(trace_id);

CREATE INDEX IF NOT EXISTS idx_ai_tool_traces_org_created_at
ON ai_tool_traces(organization_id, created_at DESC);

ALTER TABLE ai_tool_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizations can view their own AI traces"
ON ai_tool_traces FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM organization_users
        WHERE organization_id = ai_tool_traces.organization_id
        AND user_id = auth.uid()
    )
);

-- Inserts are expected to happen from the backend service role.
