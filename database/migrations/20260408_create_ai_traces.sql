-- AI Observability Tables

CREATE TABLE IF NOT EXISTS ai_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT UNIQUE NOT NULL,
    organization_id UUID REFERENCES organizations(id),
    user_id UUID REFERENCES auth.users(id),
    prompt TEXT,
    model TEXT,
    intent TEXT,
    domain TEXT,
    tool_count INTEGER DEFAULT 0,
    response_latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    cost_in_usd DECIMAL(10, 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT,
    organization_id UUID REFERENCES organizations(id),
    error_message TEXT,
    stage TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_traces_org ON ai_traces(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_traces_intent ON ai_traces(intent);
CREATE INDEX IF NOT EXISTS idx_ai_errors_trace ON ai_errors(trace_id);