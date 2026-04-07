-- Simple AI Service Schema - No Dependencies
-- Run in smaller chunks if needed

-- STEP 1: Create cache table
CREATE TABLE IF NOT EXISTS ai_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key TEXT UNIQUE NOT NULL,
    cached_data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at);

-- STEP 2: Create sessions table
CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY,
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    topics JSONB DEFAULT '{}',
    entities JSONB DEFAULT '{"customers": [], "invoices": [], "amounts": [], "dates": []}',
    context JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{"messageCount": 0, "totalTokens": 0, "currentDomain": null}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_sessions_org ON ai_sessions(organization_id);

-- STEP 3: Add columns to existing tables (if they exist)
-- These will fail silently if columns already exist or tables don't exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_requests') THEN
        ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS query_complexity TEXT;
        ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS intent_confidence FLOAT;
        ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS tools_executed INTEGER DEFAULT 0;
        ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN DEFAULT FALSE;
        ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_tool_traces') THEN
        ALTER TABLE ai_tool_traces ADD COLUMN IF NOT EXISTS reasoning JSONB;
        ALTER TABLE ai_tool_traces ADD COLUMN IF NOT EXISTS step_number INTEGER;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_knowledge') THEN
        ALTER TABLE business_knowledge ADD COLUMN IF NOT EXISTS content_hash TEXT;
        ALTER TABLE business_knowledge ADD COLUMN IF NOT EXISTS embedding JSONB;
    END IF;
END $$;