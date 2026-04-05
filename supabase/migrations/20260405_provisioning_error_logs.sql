-- Initial Migration for Provisioning Error Logging
-- Created At: 2026-04-05

CREATE TABLE IF NOT EXISTS provision_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID,
  email TEXT,
  orphaned_org_id UUID,
  failed_step TEXT,
  error_message TEXT,
  resolved BOOLEAN DEFAULT FALSE
);

-- Deny all client access (Management/Service Role Only)
ALTER TABLE provision_errors ENABLE ROW LEVEL SECURITY;

-- No policies needed as it's for backend auditing only.
