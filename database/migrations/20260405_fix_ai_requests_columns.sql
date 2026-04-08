-- Migration: Add missing columns to ai_requests table for usage tracking
ALTER TABLE ai_requests 
ADD COLUMN IF NOT EXISTS cost NUMERIC(10, 5) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS model_name TEXT,
ADD COLUMN IF NOT EXISTS total_tokens INTEGER;

-- Note: 'model_name' and 'total_tokens' might already exist in your installation,
-- but the backend code was referencing 'model' and 'tokens' which caused errors.
-- This ensures all columns the code expects are present.
