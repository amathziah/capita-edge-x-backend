import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function clearDatabase() {
  console.log('🚀 Starting deep database purge...');

  // 1. Clear Public Tables (Ordered by dependencies)
  const tables = [
    'ai_requests',
    'payments',
    'invoice_items',
    'invoices',
    'recurring_invoices',
    'reminders',
    'capita_insights',
    'expenses',
    'products',
    'customers',
    'organization_configs',
    'organization_users',
    'organizations',
    'profiles',
    'otp_verifications',
    'email_otps'
  ];

  for (const table of tables) {
    process.stdout.write(`🧹 Clearing ${table}... `);
    const { error } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete everything
    
    if (error && error.code !== '404') {
      console.log(`❌ Error: ${error.message}`);
    } else {
      console.log('✅ Done');
    }
  }

  // 2. Clear Auth Users (Admin API)
  console.log('👤 Clearing Auth Users...');
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  
  if (listError) {
    console.error('❌ Failed to list users:', listError.message);
  } else if (users && users.length > 0) {
    for (const user of users) {
      process.stdout.write(`   Deleting ${user.email}... `);
      const { error: delError } = await supabase.auth.admin.deleteUser(user.id);
      if (delError) console.log(`❌ ${delError.message}`);
      else console.log('✅');
    }
  } else {
    console.log('   No users found.');
  }

  console.log('\n✨ Database is now completely fresh.');
}

clearDatabase();
