import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase configuration in environment');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const DEFAULT_PERSONA = 'solopreneur';

const listAllUsers = async () => {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }

    const batch = data?.users ?? [];
    users.push(...batch);

    if (batch.length < 200) {
      break;
    }

    page += 1;
  }

  return users;
};

const run = async () => {
  const users = await listAllUsers();
  console.log(`[repair_auth_profiles] Found ${users.length} auth user(s).`);

  let repaired = 0;

  for (const user of users) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, business_type, organization_id')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (profile) {
      continue;
    }

    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        business_type: user.user_metadata?.business_type ?? null,
        organization_id: null,
      });

    if (upsertError) {
      throw upsertError;
    }

    repaired += 1;
    console.log(
      `[repair_auth_profiles] Recreated missing profile for ${user.email ?? user.id} with persona ${user.user_metadata?.business_type ?? DEFAULT_PERSONA}.`
    );
  }

  console.log(`[repair_auth_profiles] Repaired ${repaired} missing profile row(s).`);
};

run().catch((error) => {
  console.error('[repair_auth_profiles] Failed:', error);
  process.exit(1);
});
