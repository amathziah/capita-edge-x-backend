import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const targetEmail = process.argv[2]?.trim().toLowerCase();

if (!targetEmail) {
  console.error('Usage: node scripts/verify_stress_workspace.js <email>');
  process.exit(1);
}

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const user = users.find((entry) => entry.email?.toLowerCase() === email);
    if (user) return user;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function main() {
  const user = await findUserByEmail(targetEmail);
  if (!user) throw new Error(`User ${targetEmail} not found`);

  const { data: memberships, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .limit(1);

  if (membershipError) throw membershipError;
  if (!memberships?.length) throw new Error('No organization found');

  const orgId = memberships[0].organization_id;
  const tables = [
    'customers',
    'products',
    'invoices',
    'invoice_items',
    'payments',
    'expenses',
    'compliance_tasks',
    'reminders',
    'platform_reports',
    'ai_conversations',
    'ai_chat_messages',
    'ai_requests',
  ];

  const counts = {};
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId);

    counts[table] = error ? `ERR:${error.code || error.message}` : count;
  }

  const { data: config, error: configError } = await supabase
    .from('organization_configs')
    .select(`
      business_name,
      email,
      phone,
      address,
      currency,
      tax_label,
      invoice_prefix,
      payment_terms,
      invoice_notes,
      gstin,
      pan,
      company_tax_id,
      state,
      city,
      pincode,
      business_type,
      default_due_days,
      auto_follow_up,
      follow_up_day_1,
      follow_up_day_2,
      follow_up_day_3,
      dead_stock_threshold_days,
      reorder_alerts_enabled,
      mrr_alerts_enabled,
      weekly_summary_enabled,
      upi_id,
      bank_name,
      bank_account_number,
      bank_ifsc,
      bank_details,
      payment_instructions,
      msme_number,
      lut_number,
      frn,
      inventory_settings
    `)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (configError) throw configError;

  console.log(JSON.stringify({
    email: targetEmail,
    userId: user.id,
    orgId,
    role: memberships[0].role,
    counts,
    config,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Verification failed: ${error.message}`);
  process.exit(1);
});
