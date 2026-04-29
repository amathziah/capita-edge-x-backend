import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://enlswcufkjoemxtjtgiu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U'
);

const ORG_ID  = 'f2f6add9-107d-419f-b65f-155800aa572a';
const USER_ID = '31587d88-88c0-412e-853b-1cd1fa36d07d';
const SELLER  = {
  name: 'Malika Consulting',
  gstin: '07MALIKA1234F1Z5',
  address: '42 Nehru Place, New Delhi, Delhi 110019',
  email: 'jamathziah.23csai@nst.rishihood.edu.in',
};

const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rNum  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rDec  = (min, max) => parseFloat((Math.random() * (max - min) + min).toFixed(2));

// Date helpers
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function daysFromDate(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// Service catalogue — realistic Indian B2B services
const SERVICES = [
  { desc: 'Web Application Development',        sac: '998314', min: 25000, max: 120000 },
  { desc: 'UI/UX Design & Prototyping',          sac: '998313', min: 15000, max: 60000  },
  { desc: 'Digital Marketing Campaign',          sac: '998361', min: 18000, max: 80000  },
  { desc: 'SEO & Content Strategy',              sac: '998362', min: 12000, max: 45000  },
  { desc: 'Cloud Infrastructure Setup',          sac: '998316', min: 20000, max: 90000  },
  { desc: 'Mobile App Development (Android)',    sac: '998314', min: 40000, max: 150000 },
  { desc: 'Data Analytics & Dashboard',          sac: '998315', min: 30000, max: 100000 },
  { desc: 'Brand Identity & Logo Design',        sac: '998392', min: 8000,  max: 35000  },
  { desc: 'Social Media Management',             sac: '998363', min: 10000, max: 40000  },
  { desc: 'API Integration & Development',       sac: '998314', min: 22000, max: 75000  },
  { desc: 'Business Consulting (Monthly)',       sac: '998311', min: 20000, max: 60000  },
  { desc: 'IT Support & Maintenance',            sac: '998316', min: 8000,  max: 30000  },
  { desc: 'Cybersecurity Audit',                sac: '998315', min: 35000, max: 120000 },
  { desc: 'E-commerce Platform Development',    sac: '998314', min: 50000, max: 200000 },
  { desc: 'Video Production & Editing',         sac: '998392', min: 15000, max: 60000  },
  { desc: 'Training & Workshop (per session)',   sac: '999293', min: 5000,  max: 20000  },
  { desc: 'Logistics & Delivery Management',    sac: '996812', min: 12000, max: 50000  },
  { desc: 'HR & Recruitment Services',          sac: '998511', min: 18000, max: 70000  },
  { desc: 'Financial Modelling & Analysis',     sac: '998221', min: 25000, max: 90000  },
  { desc: 'Compliance & Legal Documentation',   sac: '998212', min: 10000, max: 45000  },
];

const GST_RATES = [0, 5, 12, 18, 28];

// Statuses weighted realistically
const STATUS_POOL = [
  'paid', 'paid', 'paid', 'paid',
  'overdue', 'overdue', 'overdue',
  'sent', 'sent',
  'draft',
];

function buildInvoiceNumber(idx) {
  return `CEX-2026-${String(idx).padStart(4, '0')}`;
}

function generateItems(gstRate, isInterstate) {
  const count = rNum(1, 3);
  const items = [];
  for (let i = 0; i < count; i++) {
    const svc = pick(SERVICES);
    const qty = rNum(1, 4);
    const price = rNum(svc.min, svc.max);
    const taxableValue = qty * price;
    const gstAmt = parseFloat(((taxableValue * gstRate) / 100).toFixed(2));
    const halfGst = parseFloat((gstAmt / 2).toFixed(2));

    items.push({
      description: svc.desc,
      quantity: qty,
      unit: 'Nos',
      price,
      tax_rate: gstRate,
      sac_code: svc.sac,
      is_service: true,
      taxable_value: taxableValue,
      gst_amount: gstAmt,
      cgst_rate: isInterstate ? 0 : gstRate / 2,
      sgst_rate: isInterstate ? 0 : gstRate / 2,
      igst_rate: isInterstate ? gstRate : 0,
      cgst_amount: isInterstate ? 0 : halfGst,
      sgst_amount: isInterstate ? 0 : halfGst,
      igst_amount: isInterstate ? gstAmt : 0,
      discount_percent: 0,
      sort_order: i,
    });
  }
  return items;
}

async function main() {
  // Fetch customers
  const { data: customers } = await sb
    .from('customers')
    .select('id,name,gstin,address,city,state,email')
    .eq('organization_id', ORG_ID);

  console.log(`Found ${customers.length} customers. Clearing old invoices...`);

  // Delete old invoice items then invoices
  const { data: oldInvoices } = await sb
    .from('invoices')
    .select('id')
    .eq('organization_id', ORG_ID);

  if (oldInvoices?.length) {
    const ids = oldInvoices.map(i => i.id);
    await sb.from('invoice_items').delete().in('invoiceId', ids);
    await sb.from('invoices').delete().eq('organization_id', ORG_ID);
  }

  console.log('Seeding 60 invoices...\n');

  let invoiceIdx = 1;
  const allInvoices = [];

  // 2 invoices per customer = 60 total
  for (const customer of customers) {
    for (let round = 0; round < 2; round++) {
      const status = pick(STATUS_POOL);
      const gstRate = pick(GST_RATES);
      const isInterstate = customer.state !== 'Delhi'; // seller is Delhi-based
      const invoiceDate = daysAgo(rNum(round === 0 ? 5 : 35, round === 0 ? 30 : 90));
      const termDays = pick([15, 30, 45]);
      const dueDate = daysFromDate(invoiceDate, termDays);

      const items = generateItems(gstRate, isInterstate);
      const subtotal = items.reduce((s, it) => s + it.taxable_value, 0);
      const totalTax = items.reduce((s, it) => s + it.gst_amount, 0);
      const total = parseFloat((subtotal + totalTax).toFixed(2));
      const cgstTotal = items.reduce((s, it) => s + it.cgst_amount, 0);
      const sgstTotal = items.reduce((s, it) => s + it.sgst_amount, 0);
      const igstTotal = items.reduce((s, it) => s + it.igst_amount, 0);

      const amountPaid = status === 'paid' ? total : status === 'sent' ? 0 : 0;
      const amountDue  = parseFloat((total - amountPaid).toFixed(2));

      const invoiceNumber = buildInvoiceNumber(invoiceIdx++);

      allInvoices.push({
        customer,
        invoice: {
          invoiceNumber,
          date: invoiceDate,
          dueDate,
          status,
          organization_id: ORG_ID,
          customer_id: customer.id,
          seller: {
            name: SELLER.name,
            gstin: SELLER.gstin,
            address: SELLER.address,
            email: SELLER.email,
          },
          buyer: {
            name: customer.name,
            gstin: customer.gstin || '',
            address: customer.address || '',
            email: customer.email || '',
          },
          subtotal,
          taxAmount: totalTax,
          taxType: gstRate > 0 ? 'GST' : 'None',
          taxRate: gstRate,
          discount: 0,
          shipping: 0,
          total,
          amount_paid: amountPaid,

          is_gst_registered: gstRate > 0,
          gst_type: gstRate === 0 ? "not_applicable" : isInterstate ? "igst" : "cgst_sgst",
          cgst_amount: parseFloat(cgstTotal.toFixed(2)),
          sgst_amount: parseFloat(sgstTotal.toFixed(2)),
          igst_amount: parseFloat(igstTotal.toFixed(2)),
          net_receivable: total,
          tds_applicable: false,
          tds_rate: 0,
          tds_amount: 0,
          place_of_supply: customer.state,
          notes: pick([
            'Thank you for your business.',
            'Payment due within the agreed terms.',
            'Please quote invoice number on payment.',
            '',
          ]),
          createdAt: new Date(invoiceDate).toISOString(),
          updatedAt: new Date().toISOString(),
        },
        items,
      });
    }
  }

  // Insert invoices in batch
  const invoiceRows = allInvoices.map(x => x.invoice);
  const { data: inserted, error: invErr } = await sb
    .from('invoices')
    .insert(invoiceRows)
    .select('id, invoiceNumber, status, total');

  if (invErr) { console.error('Invoice insert failed:', invErr.message); process.exit(1); }

  console.log(`✅ Inserted ${inserted.length} invoices`);

  // Insert items
  const itemRows = [];
  for (let i = 0; i < inserted.length; i++) {
    for (const item of allInvoices[i].items) {
      itemRows.push({
        ...item,
        invoiceId: inserted[i].id,
        organization_id: ORG_ID,
      });
    }
  }

  const { error: itemErr } = await sb.from('invoice_items').insert(itemRows);
  if (itemErr) { console.error('Items insert failed:', itemErr.message); process.exit(1); }

  console.log(`✅ Inserted ${itemRows.length} line items\n`);

  // Summary
  const byStatus = {};
  inserted.forEach(inv => { byStatus[inv.status] = (byStatus[inv.status] || 0) + 1; });
  const totalValue = inserted.reduce((s, inv) => s + inv.total, 0);

  console.log('── Summary ──────────────────────────────');
  Object.entries(byStatus).forEach(([s, n]) => console.log(`  ${s.padEnd(10)} ${n} invoices`));
  console.log(`  Total value  ₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
  console.log('─────────────────────────────────────────');
  console.log('\nSample invoices:');
  inserted.slice(0, 6).forEach(inv => console.log(`  ${inv.invoiceNumber}  ${inv.status.padEnd(8)}  ₹${inv.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`));
}

main().catch(e => { console.error(e); process.exit(1); });
