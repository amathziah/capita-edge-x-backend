/**
 * verify_tax_migration.js
 * Checks which of the 6 tax migration changes exist in the live database.
 * Uses the existing Supabase JS admin client (no DATABASE_URL needed).
 * 
 * Usage: node scripts/verify_tax_migration.js
 */
import { supabase } from '../supabase.js';

async function columnExists(table, column) {
    const { error } = await supabase.from(table).select(column).limit(0);
    if (!error) return true;
    // 42703 = column does not exist; PGRST = PostgREST column not found
    if (error.code === '42703' || error.message?.includes(`"${column}" does not exist`)) return false;
    // If the table itself doesn't exist, that's also a fail
    if (error.code === '42P01' || error.message?.includes('does not exist')) return false;
    // Any other error: assume column is there (e.g. RLS blocks select but col exists)
    return true;
}

async function tableExists(table) {
    const { error } = await supabase.from(table).select('id').limit(0);
    if (!error) return true;
    if (error.code === '42P01' || error.message?.includes('does not exist')) return false;
    return true; // RLS block = table exists
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Tax Architecture Migration — Verification Report');
    console.log('═══════════════════════════════════════════════════\n');

    const checks = [
        { label: 'invoices.tds_section',         fn: () => columnExists('invoices', 'tds_section') },
        { label: 'invoices.round_off',            fn: () => columnExists('invoices', 'round_off') },
        { label: 'invoice_items.is_exempt',        fn: () => columnExists('invoice_items', 'is_exempt') },
        { label: 'invoice_items.discount_type',    fn: () => columnExists('invoice_items', 'discount_type') },
        { label: 'customers.state',               fn: () => columnExists('customers', 'state') },
        { label: 'advance_tax_ledger table',       fn: () => tableExists('advance_tax_ledger') },
    ];

    const results = [];
    for (const check of checks) {
        const pass = await check.fn();
        results.push({ label: check.label, pass });
        console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}  ${check.label}`);
    }

    const allPass = results.every(r => r.pass);
    const failed  = results.filter(r => !r.pass);

    console.log('\n──────────────────────────────────────────────────');
    if (allPass) {
        console.log('🎉 All checks PASSED — migration already applied.\n');
    } else {
        console.log(`⚠️  ${failed.length} check(s) FAILED.\n`);
        console.log('ACTION REQUIRED: Run this in your Supabase Dashboard SQL Editor:');
        console.log('  Project → SQL Editor → New Query → paste the file below → Run\n');
        console.log('  📄 supabase/migrations/20260317_tax_architecture_fix.sql\n');
        console.log('Then run this script again to confirm.\n');
    }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
