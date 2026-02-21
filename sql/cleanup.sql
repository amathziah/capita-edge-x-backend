-- ==========================================
-- DATABASE CLEANUP SCRIPT (FRESH TEST)
-- WARNING: This will PERMANENTLY DELETE all your data.
-- ==========================================

-- 1. Disable triggers to avoid cascade issues during manual cleanup
SET session_replication_role = 'replica';

-- 2. Truncate all business tables in the correct order
-- We use CASCADE to handle foreign key dependencies automatically
TRUNCATE TABLE 
    public.ledger_entries,
    public.payments,
    public.invoices,
    public.customers,
    public.products,
    public.expenses,
    public.reminders,
    public.ai_requests,
    public.organization_configs,
    public.organization_secrets,
    public.accounts,
    public.organization_users,
    public.organizations
CASCADE;

-- 3. Reset sequences (if any)
-- This ensures IDs start from 1 again where applicable
-- (Note: Most of our IDs are UUIDs, so this is just for safety)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') 
    LOOP
        EXECUTE 'ALTER SEQUENCE public.' || quote_ident(r.sequence_name) || ' RESTART WITH 1';
    END LOOP;
END $$;

-- 4. Re-enable triggers
SET session_replication_role = 'origin';

-- ==========================================
-- STEP 2: CLEAR AUTH USERS (MANUAL)
-- ==========================================
-- To fully reset, you MUST also delete users from the 
-- Supabase Dashboard under "Authentication" -> "Users".
-- Deleting them there will clean up the Auth schema correctly.
