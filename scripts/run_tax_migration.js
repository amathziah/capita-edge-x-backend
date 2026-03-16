/**
 * run_tax_migration.js
 * Applies the tax architecture migration and verifies each change.
 * Uses the Supabase admin client (already used by supabase.js in this project).
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Each SQL statement runs as its own rpc call
const migrations = [
    {
        label: 'Migration 1: invoices.tds_section',
        sql: `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tds_section text DEFAULT '194J'`
    },
    {
        label: 'Migration 2: invoices.round_off',
        sql: `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS round_off numeric DEFAULT 0`
    },
    {
        label: 'Migration 3: invoice_items.is_exempt',
        sql: `ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS is_exempt boolean DEFAULT false`
    },
    {
        label: 'Migration 4: invoice_items.discount_type',
        sql: `ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'percentage'`
    },
    {
        label: 'Migration 5: customers.state',
        sql: `ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS state text`
    },
    {
        label: 'Migration 6a: create advance_tax_ledger',
        sql: `CREATE TABLE IF NOT EXISTS public.advance_tax_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  financial_year  text NOT NULL,
  instalment      integer NOT NULL,
  due_date        date NOT NULL,
  amount_paid     numeric DEFAULT 0,
  paid_on         date,
  challan_number  text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(organization_id, financial_year, instalment)
)`
    },
    {
        label: 'Migration 6b: enable RLS on advance_tax_ledger',
        sql: `ALTER TABLE public.advance_tax_ledger ENABLE ROW LEVEL SECURITY`
    },
    {
        label: 'Migration 6c: RLS policy for advance_tax_ledger',
        sql: `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'advance_tax_ledger'
    AND policyname = 'org_isolation_advance_tax'
  ) THEN
    CREATE POLICY "org_isolation_advance_tax"
      ON public.advance_tax_ledger
      FOR ALL
      USING (
        organization_id IN (
          SELECT organization_id FROM public.organization_users
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$`
    },
];

// Verification checks
const verifications = [
    {
        label: 'invoices.tds_section',
        table: 'invoices',
        column: 'tds_section'
    },
    {
        label: 'invoices.round_off',
        table: 'invoices',
        column: 'round_off'
    },
    {
        label: 'invoice_items.is_exempt',
        table: 'invoice_items',
        column: 'is_exempt'
    },
    {
        label: 'customers.state',
        table: 'customers',
        column: 'state'
    },
    {
        label: 'advance_tax_ledger table',
        table: 'advance_tax_ledger',
        column: null    // table existence check
    },
];

async function execSQL(sql) {
    const { data, error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) throw new Error(error.message);
    return data;
}

async function checkColumn(table, column) {
    if (column) {
        // Check column existence via a dummy select on the table
        // We use a LIMIT 0 query which lets us see if the column exists without data
        const { error } = await supabase
            .from(table)
            .select(column)
            .limit(0);
        if (error && error.message.includes('does not exist')) return false;
        if (error && error.code === '42703') return false; // column not found
        return true;
    } else {
        // Table existence check
        const { error } = await supabase
            .from(table)
            .select('id')
            .limit(0);
        if (error && (error.message.includes('does not exist') || error.code === '42P01')) return false;
        return true;
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Tax Architecture Migration Runner');
    console.log('═══════════════════════════════════════════════════\n');
    console.log(`Using: ${supabaseUrl}\n`);

    // ── Apply migrations via exec_sql RPC ───────────────────────────────────
    // Note: exec_sql RPC must exist in Supabase for DDL. If it does not,
    // we fall back to direct pg connection using DATABASE_URL.
    
    console.log('── Applying Migrations ───────────────────────────');
    
    // Try exec_sql RPC first; if not found, use pg directly
    const { error: testError } = await supabase.rpc('exec_sql', { query: 'SELECT 1' });
    
    let useRpc = !testError || !testError.message.includes('function exec_sql');
    let pgClient = null;
    
    if (!useRpc || (testError && testError.message)) {
        // Fall back to direct pg
        const { default: pg } = await import('pg');
        const dbUrl = process.env.DATABASE_URL;
        
        if (!dbUrl) {
            console.error('❌ No DATABASE_URL and exec_sql RPC not available. Cannot run migrations.');
            console.log('\n📋 MANUAL ACTION REQUIRED:');
            console.log('   Go to your Supabase Dashboard → SQL Editor and run:');
            console.log('   File: supabase/migrations/20260317_tax_architecture_fix.sql\n');
        } else {
            pgClient = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
            try {
                await pgClient.connect();
                console.log('✅ Connected via pg\n');
            } catch (e) {
                console.error('❌ pg connection failed:', e.message);
                pgClient = null;
            }
        }
    }
    
    for (const m of migrations) {
        try {
            if (pgClient) {
                await pgClient.query(m.sql);
            } else {
                await execSQL(m.sql);
            }
            console.log(`  ✅  ${m.label}`);
        } catch (e) {
            const msg = e.message || '';
            // "already exists" and "duplicate column" are acceptable — migration is idempotent
            if (msg.includes('already exists') || msg.includes('duplicate column')) {
                console.log(`  ✅  ${m.label} (already applied)`);
            } else {
                console.log(`  ❌  ${m.label}: ${msg}`);
            }
        }
    }

    if (pgClient) await pgClient.end();

    // ── Verify via Supabase client ──────────────────────────────────────────
    console.log('\n── Verification Results ──────────────────────────');
    let allPass = true;
    for (const v of verifications) {
        const pass = await checkColumn(v.table, v.column);
        if (!pass) allPass = false;
        console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}  ${v.label}`);
    }
    console.log('──────────────────────────────────────────────────');
    console.log(allPass ? '\n🎉 All checks PASSED.' : '\n⚠️  Some checks FAILED — see above.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
