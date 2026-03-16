import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// We'll use the Supabase Management API / SQL endpoint
// POST https://<project_ref>.supabase.co/rest/v1/rpc/<function_name>
// But for raw DDL, we need the pg-meta SQL endpoint:
// POST https://<project_ref>.supabase.co/pg/query

const projectRef = supabaseUrl.split('//')[1].split('.')[0];

const sections = [
  {
    name: 'SECTION 1: invoices — add missing columns',
    sql: `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cgst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS sgst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS igst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS gst_type text CHECK (gst_type IN ('cgst_sgst','igst','exempt','not_applicable')), ADD COLUMN IF NOT EXISTS tds_applicable boolean DEFAULT false, ADD COLUMN IF NOT EXISTS tds_rate numeric DEFAULT 10, ADD COLUMN IF NOT EXISTS tds_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS net_receivable numeric, ADD COLUMN IF NOT EXISTS place_of_supply text, ADD COLUMN IF NOT EXISTS reverse_charge boolean DEFAULT false, ADD COLUMN IF NOT EXISTS is_gst_registered boolean DEFAULT true, ADD COLUMN IF NOT EXISTS frn text, ADD COLUMN IF NOT EXISTS lut_number text, ADD COLUMN IF NOT EXISTS courier_name text, ADD COLUMN IF NOT EXISTS courier_tracking text, ADD COLUMN IF NOT EXISTS dispatch_date date, ADD COLUMN IF NOT EXISTS share_viewed_at timestamptz, ADD COLUMN IF NOT EXISTS follow_up_count integer DEFAULT 0, ADD COLUMN IF NOT EXISTS follow_up_last_sent_at timestamptz, ADD COLUMN IF NOT EXISTS follow_up_1_sent_at timestamptz, ADD COLUMN IF NOT EXISTS follow_up_2_sent_at timestamptz, ADD COLUMN IF NOT EXISTS follow_up_3_sent_at timestamptz;`
  },
  {
    name: 'SECTION 2: invoice_items — add missing columns',
    sql: `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS hsn_code text, ADD COLUMN IF NOT EXISTS sac_code text, ADD COLUMN IF NOT EXISTS unit text DEFAULT 'pcs', ADD COLUMN IF NOT EXISTS tax_rate numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS cgst_rate numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS sgst_rate numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS igst_rate numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS cgst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS sgst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS igst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS taxable_value numeric, ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;`
  },
  {
    name: 'SECTION 3: customers — add missing columns',
    sql: `ALTER TABLE customers ADD COLUMN IF NOT EXISTS gstin text, ADD COLUMN IF NOT EXISTS pan text, ADD COLUMN IF NOT EXISTS state text, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS pincode text, ADD COLUMN IF NOT EXISTS country text DEFAULT 'India', ADD COLUMN IF NOT EXISTS avg_payment_days numeric, ADD COLUMN IF NOT EXISTS total_invoiced_lifetime numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS total_paid_lifetime numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS late_payment_count integer DEFAULT 0, ADD COLUMN IF NOT EXISTS last_invoice_date timestamptz, ADD COLUMN IF NOT EXISTS risk_score text DEFAULT 'green' CHECK (risk_score IN ('green','yellow','red')), ADD COLUMN IF NOT EXISTS notes text;`
  },
  {
    name: 'SECTION 4: products — add missing columns',
    sql: `ALTER TABLE products ADD COLUMN IF NOT EXISTS hsn_code text, ADD COLUMN IF NOT EXISTS sac_code text;`
  },
  {
    name: 'SECTION 5: payments — add missing columns',
    sql: `ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference_number text, ADD COLUMN IF NOT EXISTS upi_transaction_id text, ADD COLUMN IF NOT EXISTS payment_mode text CHECK (payment_mode IN ('upi','neft','imps','rtgs','cheque','cash','razorpay','stripe','other'));`
  },
  {
    name: 'SECTION 6: expenses — add missing columns',
    sql: `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_name text, ADD COLUMN IF NOT EXISTS gst_amount numeric DEFAULT 0, ADD COLUMN IF NOT EXISTS is_itc_eligible boolean DEFAULT false, ADD COLUMN IF NOT EXISTS receipt_url text, ADD COLUMN IF NOT EXISTS payment_mode text, ADD COLUMN IF NOT EXISTS reference_number text;`
  },
  {
    name: 'SECTION 7: organization_configs — add missing columns',
    sql: `ALTER TABLE organization_configs ADD COLUMN IF NOT EXISTS gstin text, ADD COLUMN IF NOT EXISTS pan text, ADD COLUMN IF NOT EXISTS frn text, ADD COLUMN IF NOT EXISTS state text, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS pincode text, ADD COLUMN IF NOT EXISTS msme_number text, ADD COLUMN IF NOT EXISTS lut_number text, ADD COLUMN IF NOT EXISTS bank_name text, ADD COLUMN IF NOT EXISTS bank_account_number text, ADD COLUMN IF NOT EXISTS bank_ifsc text, ADD COLUMN IF NOT EXISTS business_type text, ADD COLUMN IF NOT EXISTS default_due_days integer DEFAULT 30, ADD COLUMN IF NOT EXISTS auto_follow_up boolean DEFAULT true, ADD COLUMN IF NOT EXISTS follow_up_day_1 integer DEFAULT 7, ADD COLUMN IF NOT EXISTS follow_up_day_2 integer DEFAULT 14, ADD COLUMN IF NOT EXISTS follow_up_day_3 integer DEFAULT 30, ADD COLUMN IF NOT EXISTS dead_stock_threshold_days integer DEFAULT 60, ADD COLUMN IF NOT EXISTS reorder_alerts_enabled boolean DEFAULT true, ADD COLUMN IF NOT EXISTS mrr_alerts_enabled boolean DEFAULT true, ADD COLUMN IF NOT EXISTS weekly_summary_enabled boolean DEFAULT true;`
  },
  {
    name: 'SECTION 8: create recurring_invoices table',
    sql: `CREATE TABLE IF NOT EXISTS recurring_invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, invoice_template jsonb NOT NULL, frequency text NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','annual')), next_due_date date NOT NULL, last_sent_at timestamptz, is_active boolean DEFAULT true, auto_send boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());`
  },
  {
    name: 'SECTION 8b: RLS for recurring_invoices',
    sql: `ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY; DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recurring_invoices' AND policyname = 'org members can manage recurring invoices') THEN CREATE POLICY "org members can manage recurring invoices" ON recurring_invoices USING (organization_id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())); END IF; END $$;`
  },
  {
    name: 'SECTION 9: create capita_insights table',
    sql: `CREATE TABLE IF NOT EXISTS capita_insights (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, type text NOT NULL CHECK (type IN ('dead_money','late_payer','cash_projection','rate_raise','stock_alert','mrr_drop','itc_reminder','follow_up_due','revenue_concentration','duplicate_invoice','health_score')), title text NOT NULL, body text NOT NULL, data jsonb DEFAULT '{}', severity text DEFAULT 'info' CHECK (severity IN ('info','warning','critical')), is_read boolean DEFAULT false, is_dismissed boolean DEFAULT false, created_at timestamptz DEFAULT now());`
  },
  {
    name: 'SECTION 9b: RLS for capita_insights',
    sql: `ALTER TABLE capita_insights ENABLE ROW LEVEL SECURITY; DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'capita_insights' AND policyname = 'org members can manage capita insights') THEN CREATE POLICY "org members can manage capita insights" ON capita_insights USING (organization_id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())); END IF; END $$;`
  },
  {
    name: 'SECTION 10: create reminders table',
    sql: `CREATE TABLE IF NOT EXISTS reminders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE, customer_id uuid REFERENCES customers(id) ON DELETE SET NULL, reminder_type text NOT NULL CHECK (reminder_type IN ('follow_up_1','follow_up_2','follow_up_3','custom')), scheduled_at timestamptz NOT NULL, sent_at timestamptz, status text DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')), channel text DEFAULT 'email' CHECK (channel IN ('email','whatsapp','both')), message_body text, created_at timestamptz DEFAULT now());`
  },
  {
    name: 'SECTION 10b: RLS for reminders',
    sql: `ALTER TABLE reminders ENABLE ROW LEVEL SECURITY; DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reminders' AND policyname = 'org members can manage reminders') THEN CREATE POLICY "org members can manage reminders" ON reminders USING (organization_id IN (SELECT organization_id FROM organization_users WHERE user_id = auth.uid())); END IF; END $$;`
  },
  {
    name: 'SECTION 11a: RPC - update_customer_intelligence',
    sql: `CREATE OR REPLACE FUNCTION update_customer_intelligence(p_customer_id uuid) RETURNS void AS $$ DECLARE v_avg_days numeric; v_late_count integer; v_total_invoiced numeric; v_total_paid numeric; v_last_invoice timestamptz; v_risk text; BEGIN SELECT AVG(EXTRACT(EPOCH FROM (p.date - i.date)) / 86400), COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (p.date - i.date)) / 86400 > 30), SUM(i.total), SUM(p.amount), MAX(i.date) INTO v_avg_days, v_late_count, v_total_invoiced, v_total_paid, v_last_invoice FROM invoices i JOIN payments p ON p."invoiceId" = i.id WHERE i.customer_id = p_customer_id AND i.status = 'paid'; IF v_avg_days IS NULL THEN v_risk := 'green'; ELSIF v_avg_days > 60 OR v_late_count > 3 THEN v_risk := 'red'; ELSIF v_avg_days > 30 THEN v_risk := 'yellow'; ELSE v_risk := 'green'; END IF; UPDATE customers SET avg_payment_days = COALESCE(v_avg_days, 0), late_payment_count = COALESCE(v_late_count, 0), total_invoiced_lifetime = COALESCE(v_total_invoiced, 0), total_paid_lifetime = COALESCE(v_total_paid, 0), last_invoice_date = v_last_invoice, risk_score = v_risk, "updatedAt" = now() WHERE id = p_customer_id; END; $$ LANGUAGE plpgsql SECURITY DEFINER;`
  },
  {
    name: 'SECTION 11b: RPC - get_cash_projection',
    sql: `CREATE OR REPLACE FUNCTION get_cash_projection(p_organization_id uuid) RETURNS jsonb AS $$ DECLARE v_result jsonb; BEGIN SELECT jsonb_build_object('week_1', COALESCE(SUM(total) FILTER (WHERE "dueDate" BETWEEN now() AND now() + interval '7 days'), 0), 'week_2', COALESCE(SUM(total) FILTER (WHERE "dueDate" BETWEEN now() + interval '7 days' AND now() + interval '14 days'), 0), 'week_3', COALESCE(SUM(total) FILTER (WHERE "dueDate" BETWEEN now() + interval '14 days' AND now() + interval '21 days'), 0), 'week_4', COALESCE(SUM(total) FILTER (WHERE "dueDate" BETWEEN now() + interval '21 days' AND now() + interval '28 days'), 0), 'overdue', COALESCE(SUM(total) FILTER (WHERE "dueDate" < now() AND status NOT IN ('paid','cancelled')), 0), 'total_expected', COALESCE(SUM(total) FILTER (WHERE "dueDate" BETWEEN now() AND now() + interval '28 days' AND status NOT IN ('paid','cancelled')), 0)) INTO v_result FROM invoices WHERE organization_id = p_organization_id AND status NOT IN ('paid','cancelled'); RETURN v_result; END; $$ LANGUAGE plpgsql SECURITY DEFINER;`
  },
  {
    name: 'SECTION 11c: RPC - get_mrr',
    sql: `CREATE OR REPLACE FUNCTION get_mrr(p_organization_id uuid) RETURNS numeric AS $$ DECLARE v_mrr numeric; BEGIN SELECT COALESCE(SUM(total), 0) INTO v_mrr FROM invoices WHERE organization_id = p_organization_id AND persona = 'subscription' AND status = 'paid' AND date >= date_trunc('month', now()) AND date < date_trunc('month', now()) + interval '1 month'; RETURN v_mrr; END; $$ LANGUAGE plpgsql SECURITY DEFINER;`
  }
];

async function executeSql(sql) {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ query: sql }),
  });
  return response;
}

// Use pg-meta endpoint for raw SQL
async function runRawSql(sql) {
  // The Supabase pg endpoint for running raw SQL:
  // https://<project_ref>.supabase.co/pg/query
  const response = await fetch(`https://${projectRef}.supabase.co/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return await response.json();
}

async function main() {
  console.log('🚀 Starting migration execution...');
  console.log(`📡 Target: ${supabaseUrl}\n`);

  let successCount = 0;
  let failCount = 0;

  for (const section of sections) {
    process.stdout.write(`📌 ${section.name}... `);
    try {
      const result = await runRawSql(section.sql);
      console.log('✅ Success');
      successCount++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      failCount++;
    }
  }

  console.log(`\n═══════════════════════`);
  console.log(`✅ Passed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`═══════════════════════`);
  
  if (failCount > 0) {
    console.log('\n⚠️  Some sections failed. They need to be run manually in the Supabase SQL Editor.');
    console.log('   Go to: https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
  }

  // Verification
  console.log('\n📊 Running verification...');
  const tables = ['invoices', 'invoice_items', 'customers', 'products', 'payments', 'expenses', 'organization_configs', 'recurring_invoices', 'capita_insights', 'reminders'];
  for (const table of tables) {
    try {
      const result = await runRawSql(`SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position;`);
      console.log(`\n📋 ${table}:`);
      if (result && Array.isArray(result)) {
        result.forEach(r => console.log(`   ${r.column_name} (${r.data_type})`));
      } else {
        console.log('   ', JSON.stringify(result));
      }
    } catch (err) {
      console.log(`   Could not verify ${table}: ${err.message}`);
    }
  }
}

main();
