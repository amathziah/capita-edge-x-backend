import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase credentials in backend .env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const serializeError = (error) => ({
  message: error?.message || '',
  details: error?.details || '',
  hint: error?.hint || '',
  code: error?.code || '',
  name: error?.name || ''
});

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();

  if (!email) {
    console.error('Usage: node scripts/reset_ai_limit.js <email>');
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', user.id);

  if (membershipError) throw membershipError;

  const orgIds = [...new Set((memberships || []).map((row) => row.organization_id).filter(Boolean))];

  if (orgIds.length === 0) {
    console.error(`No organization found for ${email}`);
    process.exit(1);
  }

  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);
  const monthStartIso = firstOfMonth.toISOString();
  const timestampColumns = ['created_at', 'createdAt'];

  for (const organizationId of orgIds) {
    let workingTimestampColumn = null;
    let beforeCount = 0;

    for (const timestampColumn of timestampColumns) {
      const { count, error } = await supabase
        .from('ai_requests')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte(timestampColumn, monthStartIso);

      if (!error) {
        workingTimestampColumn = timestampColumn;
        beforeCount = count || 0;
        break;
      }

      console.error(`Count failed for ${timestampColumn}:`, serializeError(error));
    }

    if (!workingTimestampColumn) {
      throw new Error(`Unable to query ai_requests timestamp column for organization ${organizationId}`);
    }

    const { error: deleteError } = await supabase
      .from('ai_requests')
      .delete()
      .eq('organization_id', organizationId)
      .gte(workingTimestampColumn, monthStartIso);

    if (deleteError) {
      console.error('Delete failed:', serializeError(deleteError));
      throw deleteError;
    }

    const { count: afterCount, error: afterError } = await supabase
      .from('ai_requests')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte(workingTimestampColumn, monthStartIso);

    if (afterError) {
      console.error('Post-delete count failed:', serializeError(afterError));
      throw afterError;
    }

    console.log(JSON.stringify({
      email,
      userId: user.id,
      organizationId,
      timestampColumn: workingTimestampColumn,
      monthWindowStart: monthStartIso,
      deletedCount: beforeCount || 0,
      remainingCount: afterCount || 0
    }, null, 2));
  }
}

main().catch((error) => {
  console.error('Reset failed:', serializeError(error));
  process.exit(1);
});
