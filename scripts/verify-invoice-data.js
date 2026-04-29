import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://enlswcufkjoemxtjtgiu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U'
);

const ORG = 'f2f6add9-107d-419f-b65f-155800aa572a';

const { data: invs } = await sb.from('invoices').select('*').eq('organization_id', ORG);
const { data: pays } = await sb.from('payments').select('*').eq('organization_id', ORG);

const today = new Date(); // use real today

const byStatus = {};
let billed = 0, paid = 0, outstanding = 0, overdueAmt = 0;
const overdueList = [];
for (const inv of invs || []) {
  byStatus[inv.status] = (byStatus[inv.status] || 0) + 1;
  billed += Number(inv.total || 0);
  if (inv.status === 'paid') paid += Number(inv.total || 0);
  else outstanding += Number(inv.total || 0);

  if (inv.status !== 'paid' && inv.status !== 'draft' && inv.due_date) {
    const due = new Date(inv.due_date);
    if (due < today) {
      overdueAmt += Number(inv.total || 0);
      overdueList.push({ n: inv.invoice_number, total: inv.total, due: inv.due_date, status: inv.status });
    }
  }
  if (inv.status === 'overdue') {
    if (!overdueList.find(x => x.n === inv.invoice_number)) {
      overdueAmt += Number(inv.total || 0);
      overdueList.push({ n: inv.invoice_number, total: inv.total, due: inv.due_date, status: inv.status });
    }
  }
}

console.log('today:', today.toISOString().slice(0,10));
console.log('Total invoices:', invs.length);
console.log('By status:', byStatus);
console.log('Billed total:', billed.toFixed(2));
console.log('Paid total (status=paid):', paid.toFixed(2));
console.log('Outstanding (non-paid):', outstanding.toFixed(2));
console.log('Overdue (status=overdue OR past-due-not-paid):', overdueAmt.toFixed(2));
console.log('Overdue count:', overdueList.length);

console.log('\nPayments rows:', pays?.length);
const paySum = (pays || []).reduce((s,p) => s + Number(p.amount || 0), 0);
console.log('Payments sum:', paySum.toFixed(2));
