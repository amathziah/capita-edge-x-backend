import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const targetEmail = process.argv[2]?.trim().toLowerCase();

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!targetEmail) {
  console.error('Usage: node scripts/clear_user_workspace.js <email>');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const orgCleanupOperations = [
  { table: 'ai_chat_messages', column: 'organization_id' },
  { table: 'ai_conversations', column: 'organization_id' },
  { table: 'ai_requests', column: 'organization_id' },
  { table: 'ledger_entries', column: 'organization_id' },
  { table: 'payments', column: 'organization_id' },
  { table: 'invoice_items', column: 'organization_id' },
  { table: 'invoices', column: 'organization_id' },
  { table: 'recurring_invoices', column: 'organization_id' },
  { table: 'reminders', column: 'organization_id' },
  { table: 'capita_insights', column: 'organization_id' },
  { table: 'platform_reports', column: 'organization_id' },
  { table: 'notifications', column: 'organization_id' },
  { table: 'compliance_tasks', column: 'organization_id' },
  { table: 'expenses', column: 'organization_id' },
  { table: 'products', column: 'organization_id' },
  { table: 'customers', column: 'organization_id' },
  { table: 'settings', column: 'organization_id' },
  { table: 'accounts', column: 'organization_id' },
  { table: 'invoice_sequences', column: 'organization_id' },
  { table: 'organization_configs', column: 'organization_id' },
  { table: 'organization_secrets', column: 'organization_id' },
  { table: 'ca_client_relationships', column: 'ca_organization_id' },
  { table: 'ca_client_relationships', column: 'client_organization_id' },
];

const userCleanupOperations = [
  { table: 'otp_verifications', column: 'email', useEmail: true },
  { table: 'ai_chat_messages', column: 'user_id' },
  { table: 'ai_conversations', column: 'user_id' },
  { table: 'ai_requests', column: 'user_id' },
  { table: 'platform_reports', column: 'user_id' },
  { table: 'provision_errors', column: 'user_id' },
  { table: 'provision_errors', column: 'email', useEmail: true },
];

const isSkippableError = (error) => (
  error.code === 'PGRST205' ||
  error.code === '42P01' ||
  error.code === '42703'
);

const deleteAllByColumn = async (table, column, value) => {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq(column, value);

  if (error && !isSkippableError(error)) {
    throw new Error(`${table}.${column}: ${error.message}`);
  }

  return !error;
};

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

async function getOrganizationIds(userId) {
  const orgIds = new Set();

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id')
    .eq('user_id', userId);

  if (membershipError) throw membershipError;

  for (const row of memberships || []) {
    if (row.organization_id) orgIds.add(row.organization_id);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  if (profile?.organization_id) orgIds.add(profile.organization_id);

  return [...orgIds];
}

async function clearOrganizationWorkspace(organizationId) {
  console.log(`\nClearing workspace data for organization ${organizationId}`);

  for (const operation of orgCleanupOperations) {
    process.stdout.write(`- ${operation.table}.${operation.column}... `);

    try {
      const deleted = await deleteAllByColumn(operation.table, operation.column, organizationId);
      console.log(deleted ? 'done' : 'skipped');
    } catch (error) {
      console.log('error');
      throw error;
    }
  }
}

async function clearUserWorkspace() {
  console.log(`Looking up user ${targetEmail}`);
  const user = await findUserByEmail(targetEmail);

  if (!user) {
    console.error(`User not found for email: ${targetEmail}`);
    process.exit(1);
  }

  const organizationIds = await getOrganizationIds(user.id);

  if (!organizationIds.length) {
    console.log('No organizations found for this user. Clearing user-scoped residual data only.');
  }

  for (const organizationId of organizationIds) {
    await clearOrganizationWorkspace(organizationId);
  }

  console.log('\nClearing user-scoped residual data');
  for (const operation of userCleanupOperations) {
    process.stdout.write(`- ${operation.table}.${operation.column}... `);
    const value = operation.useEmail ? targetEmail : user.id;

    try {
      const deleted = await deleteAllByColumn(operation.table, operation.column, value);
      console.log(deleted ? 'done' : 'skipped');
    } catch (error) {
      console.log('error');
      throw error;
    }
  }

  console.log('\nWorkspace reset complete.');
  console.log(`Account preserved for ${targetEmail}`);
  console.log(`Organizations preserved: ${organizationIds.length}`);
}

clearUserWorkspace().catch((error) => {
  console.error(`Workspace reset failed: ${error.message}`);
  process.exit(1);
});
