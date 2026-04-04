-- RPC to securely find a user by email from the backend
-- This bypasses the potentially slow or paginated listUsers API
CREATE OR REPLACE FUNCTION public.get_user_by_email_v2(search_email text)
RETURNS TABLE (
  id uuid,
  email text,
  email_confirmed_at timestamptz
) 
SECURITY DEFINER
SET search_path = public, auth
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email::text, u.email_confirmed_at
  FROM auth.users u
  WHERE u.email = search_email
  LIMIT 1;
END;
$$;

-- Grant execution to service_role (used by backend)
GRANT EXECUTE ON FUNCTION public.get_user_by_email_v2(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_by_email_v2(text) TO postgres;
