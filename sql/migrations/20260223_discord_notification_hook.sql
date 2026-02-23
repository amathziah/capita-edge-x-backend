-- Migration to set up Discord Notification Hook for platform_reports
-- This requires the pg_net extension to be enabled in your Supabase project

-- 1. Enable pg_net
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Create the Trigger Function
CREATE OR REPLACE FUNCTION public.notify_discord_on_platform_report()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM
    net.http_post(
      url := 'https://' ||'enlswcufkjoemxtjtgiu' || '.functions.supabase.co/notify-discord',
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || '[YOUR_ANON_KEY]' -- IMPORTANT: Replace with your actual anon key in the SQL editor
      ),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the Trigger
DROP TRIGGER IF EXISTS tr_platform_report_discord ON platform_reports;
CREATE TRIGGER tr_platform_report_discord
AFTER INSERT ON platform_reports
FOR EACH ROW EXECUTE FUNCTION public.notify_discord_on_platform_report();
