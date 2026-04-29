import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://enlswcufkjoemxtjtgiu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U'
);

const ORG = 'f2f6add9-107d-419f-b65f-155800aa572a';
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Sample one row to learn the payments schema
const probe = await sb.from('payments').select('*').limit(1);
console.log('payments columns:', Object.keys(probe.data?.[0] || {}).join(', '));

const { data: paidInvs, error: invErr } = await sb
  .from('invoices')
  .select('id, invoiceNumber, total, customer_id, date, dueDate, organization_id')
  .eq('organization_id', ORG)
  .eq('status', 'paid');

if (invErr) { console.error(invErr); process.exit(1); }
console.log(`Found ${paidInvs.length} paid invoices`);

// Find which invoices already have payments
const invIds = paidInvs.map(i => i.id);
const { data: existing } = await sb
  .from('payments')
  .select('invoiceId')
  .in('invoiceId', invIds);
const haveIds = new Set((existing || []).map(p => p.invoiceId));
console.log(`${haveIds.size} already have payment rows`);

const toInsert = paidInvs
  .filter(inv => !haveIds.has(inv.id))
  .map((inv, i) => {
    const base = new Date(inv.date || inv.dueDate || new Date());
    base.setDate(base.getDate() + Math.floor(Math.random() * 25) + 1);
    const method = pick(['upi', 'neft', 'rtgs', 'cheque', 'cash']);
    return {
      organization_id: ORG,
      customer_id: inv.customer_id,
      invoiceId: inv.id,
      amount: Number(inv.total),
      date: base.toISOString(),
      method,
      payment_mode: method,
      reference_number: `PAY-${Date.now().toString(36).toUpperCase()}-${i}`,
      notes: 'Full payment received',
      status: 'completed',
    };
  });

if (!toInsert.length) {
  console.log('Nothing to insert.');
  process.exit(0);
}

const { data, error } = await sb.from('payments').insert(toInsert).select('id');
if (error) { console.error('Insert error:', error.message); process.exit(1); }
console.log(`✅ Inserted ${data.length} payment rows`);
const total = toInsert.reduce((s, p) => s + Number(p.amount), 0);
console.log(`   Sum: ₹${total.toLocaleString('en-IN')}`);
