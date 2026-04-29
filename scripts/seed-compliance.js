import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://enlswcufkjoemxtjtgiu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U'
);

const ORG_ID = 'f2f6add9-107d-419f-b65f-155800aa572a';

// Today is 2026-04-29
const tasks = [

  // ── COMPLETED (past, filed on time) ──────────────────────────────────────
  { type: 'GST Return',    description: 'GSTR-1 Filing – January 2026',         due_date: '2026-02-11', status: 'completed', priority: 'high',     notes: 'Filed on 10 Feb 2026. Outward supplies reported: ₹18.4L.' },
  { type: 'GST Return',    description: 'GSTR-3B Filing – January 2026',         due_date: '2026-02-20', status: 'completed', priority: 'high',     notes: 'Filed on 19 Feb 2026. Net tax paid: ₹2.76L.' },
  { type: 'TDS Payment',   description: 'TDS Payment – January 2026 (Sec 194J)', due_date: '2026-02-07', status: 'completed', priority: 'high',     notes: 'Paid ₹12,400 via NEFT. Challan no. TDS-2026-01.' },
  { type: 'GST Return',    description: 'GSTR-1 Filing – February 2026',         due_date: '2026-03-11', status: 'completed', priority: 'high',     notes: 'Filed on 10 Mar 2026. Outward supplies: ₹22.1L.' },
  { type: 'GST Return',    description: 'GSTR-3B Filing – February 2026',        due_date: '2026-03-20', status: 'completed', priority: 'high',     notes: 'Filed on 18 Mar 2026. Net tax paid: ₹3.32L.' },
  { type: 'TDS Payment',   description: 'TDS Payment – February 2026 (Sec 194J)',due_date: '2026-03-07', status: 'completed', priority: 'high',     notes: 'Paid ₹15,200. Challan no. TDS-2026-02.' },
  { type: 'PF/ESI',        description: 'PF Contribution – February 2026',       due_date: '2026-03-15', status: 'completed', priority: 'medium',   notes: 'PF deposited for 4 employees. Total: ₹28,400.' },
  { type: 'GST Return',    description: 'GSTR-1 Filing – March 2026',            due_date: '2026-04-11', status: 'completed', priority: 'high',     notes: 'Filed on 10 Apr 2026. Outward supplies: ₹19.8L.' },
  { type: 'GST Return',    description: 'GSTR-3B Filing – March 2026',           due_date: '2026-04-20', status: 'completed', priority: 'high',     notes: 'Filed on 19 Apr 2026. Net tax paid: ₹2.97L.' },
  { type: 'TDS Payment',   description: 'TDS Payment – March 2026 (Sec 194J)',   due_date: '2026-04-07', status: 'completed', priority: 'high',     notes: 'Paid ₹18,600. Challan no. TDS-2026-03.' },
  { type: 'PF/ESI',        description: 'PF Contribution – March 2026',          due_date: '2026-04-15', status: 'completed', priority: 'medium',   notes: 'PF deposited. Total: ₹28,400.' },
  { type: 'Annual Return', description: 'GSTR-9 Annual Return – FY 2024-25',     due_date: '2025-12-31', status: 'completed', priority: 'critical', notes: 'Filed on 28 Dec 2025. Turnover declared: ₹2.4 Cr.' },
  { type: 'Tax Audit',     description: 'Tax Audit under Sec 44AB – FY 2024-25', due_date: '2025-10-31', status: 'completed', priority: 'critical', notes: 'Audit completed by CA Sharma. Report submitted 28 Oct 2025.' },

  // ── OVERDUE (missed deadlines) ────────────────────────────────────────────
  { type: 'TDS Payment',   description: 'TDS Payment – April 2026 (Sec 194C)',   due_date: '2026-04-07', status: 'overdue',   priority: 'critical', notes: 'TDS on contractor payments due 7 Apr. Not yet deposited. Late interest @ 1.5%/month.' },
  { type: 'E-Way Bill',    description: 'E-Way Bill reconciliation – Q4 FY26',   due_date: '2026-04-15', status: 'overdue',   priority: 'high',     notes: 'Pending reconciliation of 12 e-way bills for March shipments.' },
  { type: 'PF/ESI',        description: 'ESI Contribution – March 2026',         due_date: '2026-04-15', status: 'overdue',   priority: 'high',     notes: 'ESI not deposited for March. Penalty accruing.' },

  // ── PENDING / UPCOMING ────────────────────────────────────────────────────
  { type: 'TDS Payment',   description: 'TDS Payment – April 2026 (Sec 194J)',   due_date: '2026-05-07', status: 'pending',   priority: 'critical', notes: 'TDS on professional fees for April. Estimated: ₹21,000. Due 7 May.' },
  { type: 'GST Return',    description: 'GSTR-1 Filing – April 2026',            due_date: '2026-05-11', status: 'pending',   priority: 'high',     notes: 'Monthly GSTR-1 for April 2026. Ensure all B2B invoices are uploaded.' },
  { type: 'GST Return',    description: 'GSTR-3B Filing – April 2026',           due_date: '2026-05-20', status: 'pending',   priority: 'high',     notes: 'Summary return for April 2026. ITC reconciliation needed before filing.' },
  { type: 'PF/ESI',        description: 'PF/ESI Contribution – April 2026',      due_date: '2026-05-15', status: 'pending',   priority: 'medium',   notes: 'Monthly PF + ESI deposit for April. Approx ₹28,400.' },
  { type: 'TDS Payment',   description: 'Advance Tax Instalment 1 – Q1 FY27',   due_date: '2026-06-15', status: 'pending',   priority: 'critical', notes: 'First advance tax instalment for FY 2026-27. At least 15% of estimated annual tax.' },
  { type: 'GST Return',    description: 'GSTR-1 Filing – May 2026',              due_date: '2026-06-11', status: 'pending',   priority: 'high',     notes: 'Monthly GSTR-1 for May 2026.' },
  { type: 'GST Return',    description: 'GSTR-3B Filing – May 2026',             due_date: '2026-06-20', status: 'pending',   priority: 'high',     notes: 'Monthly GSTR-3B for May 2026.' },
  { type: 'TDS Payment',   description: 'TDS Payment – May 2026 (Sec 194J)',     due_date: '2026-06-07', status: 'pending',   priority: 'high',     notes: 'TDS on professional fees for May.' },
  { type: 'PF/ESI',        description: 'PF/ESI Contribution – May 2026',        due_date: '2026-06-15', status: 'pending',   priority: 'medium',   notes: 'Monthly PF + ESI deposit for May.' },
  { type: 'ROC Filing',    description: 'DIR-3 KYC for Directors – FY 2025-26',  due_date: '2026-09-30', status: 'pending',   priority: 'medium',   notes: 'Annual KYC for all directors. Penalty ₹5,000 if missed.' },
  { type: 'Annual Return', description: 'GSTR-9 Annual Return – FY 2025-26',     due_date: '2026-12-31', status: 'pending',   priority: 'critical', notes: 'Annual GST return for FY 2026. Prepare from monthly filings. Mandatory if turnover > ₹2 Cr.' },
  { type: 'Tax Audit',     description: 'Tax Audit under Sec 44AB – FY 2025-26', due_date: '2026-10-31', status: 'pending',   priority: 'critical', notes: 'Engage CA by August. Upload Form 3CA/3CB before 31 Oct 2026.' },
  { type: 'ROC Filing',    description: 'Form AOC-4 (Financial Statements)',      due_date: '2026-10-30', status: 'pending',   priority: 'high',     notes: 'File audited financials with MCA within 30 days of AGM.' },
  { type: 'ROC Filing',    description: 'Form MGT-7 (Annual Return to ROC)',      due_date: '2026-11-30', status: 'pending',   priority: 'high',     notes: 'Annual return to Registrar of Companies. File within 60 days of AGM.' },
  { type: 'TDS Payment',   description: 'Advance Tax Instalment 2 – Q2 FY27',   due_date: '2026-09-15', status: 'pending',   priority: 'critical', notes: 'Second advance tax instalment. Cumulative 45% of annual tax by 15 Sep.' },
  { type: 'TDS Payment',   description: 'Advance Tax Instalment 3 – Q3 FY27',   due_date: '2026-12-15', status: 'pending',   priority: 'high',     notes: 'Third advance tax instalment. Cumulative 75% of annual tax by 15 Dec.' },
  { type: 'E-Way Bill',    description: 'E-Way Bill reconciliation – Q1 FY27',   due_date: '2026-07-15', status: 'pending',   priority: 'medium',   notes: 'Reconcile all e-way bills generated in Apr–Jun 2026 with GSTR data.' },
  { type: 'Other',         description: 'MSME Payment Compliance – MSME-1 Form', due_date: '2026-10-31', status: 'pending',   priority: 'medium',   notes: 'Half-yearly return for outstanding payments to MSMEs exceeding 45 days.' },
];

async function main() {
  console.log(`Clearing existing compliance tasks for org...`);
  await sb.from('compliance_tasks').delete().eq('organization_id', ORG_ID);

  const rows = tasks.map(t => ({
    ...t,
    organization_id: ORG_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await sb.from('compliance_tasks').insert(rows).select('id, type, status, due_date');
  if (error) { console.error('Insert failed:', error.message); process.exit(1); }

  const byStatus = {};
  data.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  console.log(`\n✅ Seeded ${data.length} compliance tasks\n`);
  console.log('── Summary ──────────────────────────────');
  Object.entries(byStatus).sort().forEach(([s, n]) => console.log(`  ${s.padEnd(12)} ${n} tasks`));
  console.log('─────────────────────────────────────────');
}

main().catch(e => { console.error(e); process.exit(1); });
