import dotenv from 'dotenv';
import { supabase } from '../src/core/database/supabase.js';

dotenv.config();

const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/reset_ai_limits.js <email>');
  process.exit(1);
}

async function main() {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, organization_id, email')
    .eq('email', email)
    .maybeSingle();

  if (userError) throw userError;
  if (!user) {
    console.log(JSON.stringify({ ok: false, reason: 'user_not_found', email }, null, 2));
    process.exit(0);
  }

  const { error: deleteError } = await supabase
    .from('ai_requests')
    .delete()
    .eq('organization_id', user.organization_id);

  if (deleteError) throw deleteError;

  const { count, error: countError } = await supabase
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', user.organization_id);

  if (countError) throw countError;

  console.log(JSON.stringify({
    ok: true,
    email,
    user_id: user.id,
    organization_id: user.organization_id,
    remaining_ai_requests: count || 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    email,
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
