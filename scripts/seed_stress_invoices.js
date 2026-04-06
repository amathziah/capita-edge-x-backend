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
  console.error('Usage: node scripts/seed_stress_invoices.js <email>');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const productsCatalog = [
  { name: 'Brand Identity Sprint', description: 'Logo, type system, and visual direction', price: 18000, unit: 'project', hsn_code: '998397', tax_rate: 18, category: 'Design' },
  { name: 'Landing Page Build', description: 'Marketing site design and frontend implementation', price: 32000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Development' },
  { name: 'Monthly Design Retainer', description: 'Ongoing design support for campaigns and assets', price: 22000, unit: 'month', hsn_code: '998397', tax_rate: 18, category: 'Retainer' },
  { name: 'Product UI Audit', description: 'UX teardown with prioritized recommendations', price: 12000, unit: 'audit', hsn_code: '998397', tax_rate: 18, category: 'Consulting' },
  { name: 'Social Creative Pack', description: 'Short-form ads and social media design batch', price: 9500, unit: 'pack', hsn_code: '998366', tax_rate: 18, category: 'Marketing' },
  { name: 'Website Maintenance', description: 'Fixes, updates, and deployment support', price: 8000, unit: 'month', hsn_code: '998314', tax_rate: 18, category: 'Support' },
  { name: 'Pitch Deck Design', description: 'Founder-ready 12 slide presentation deck', price: 15000, unit: 'project', hsn_code: '998397', tax_rate: 18, category: 'Design' },
  { name: 'Email Funnel Setup', description: 'Lifecycle campaign structure and templates', price: 11000, unit: 'project', hsn_code: '998366', tax_rate: 18, category: 'Marketing' },
  { name: 'Analytics Setup', description: 'GA4, events, and dashboard instrumentation', price: 14000, unit: 'setup', hsn_code: '998314', tax_rate: 18, category: 'Analytics' },
  { name: 'Consulting Session', description: 'Strategy and finance ops advisory session', price: 3500, unit: 'hour', hsn_code: '998318', tax_rate: 18, category: 'Consulting' },
];

const scenarioDefinitions = [
  { code: 'DRAFT-NEW', label: 'Draft Invoice', storedStatus: 'draft', daysFromToday: -1, dueInDays: 14, paymentRatio: 0, items: [0, 9] },
  { code: 'DRAFT-LARGE', label: 'Draft Proposal', storedStatus: 'draft', daysFromToday: -3, dueInDays: 21, paymentRatio: 0, items: [1, 2, 6] },
  { code: 'SENT-CURRENT', label: 'Sent Current', storedStatus: 'sent', daysFromToday: -2, dueInDays: 10, paymentRatio: 0, items: [1, 4] },
  { code: 'SENT-DUE-TODAY', label: 'Sent Due Today', storedStatus: 'sent', daysFromToday: -15, dueInDays: 0, paymentRatio: 0, items: [2, 5] },
  { code: 'SENT-OVERDUE-3', label: 'Sent Overdue 3D', storedStatus: 'sent', daysFromToday: -18, dueInDays: -3, paymentRatio: 0, items: [3, 8] },
  { code: 'SENT-OVERDUE-21', label: 'Sent Overdue 21D', storedStatus: 'sent', daysFromToday: -45, dueInDays: -21, paymentRatio: 0, items: [0, 1, 7] },
  { code: 'PARTIAL-CURRENT-25', label: 'Partial Current 25%', storedStatus: 'partially_paid', daysFromToday: -4, dueInDays: 12, paymentRatio: 0.25, items: [2, 4, 9] },
  { code: 'PARTIAL-CURRENT-60', label: 'Partial Current 60%', storedStatus: 'partially_paid', daysFromToday: -9, dueInDays: 18, paymentRatio: 0.6, items: [1, 5] },
  { code: 'PARTIAL-DUE-TODAY', label: 'Partial Due Today', storedStatus: 'partially_paid', daysFromToday: -20, dueInDays: 0, paymentRatio: 0.4, items: [6, 9] },
  { code: 'PARTIAL-OVERDUE-5', label: 'Partial Overdue 5D', storedStatus: 'partially_paid', daysFromToday: -22, dueInDays: -5, paymentRatio: 0.35, items: [0, 3, 8] },
  { code: 'PARTIAL-OVERDUE-30', label: 'Partial Overdue 30D', storedStatus: 'partially_paid', daysFromToday: -60, dueInDays: -30, paymentRatio: 0.5, items: [1, 2, 5] },
  { code: 'PAID-RECENT', label: 'Paid Recent', storedStatus: 'paid', daysFromToday: -6, dueInDays: 7, paymentRatio: 1, items: [4, 7] },
  { code: 'PAID-OLD', label: 'Paid Closed', storedStatus: 'paid', daysFromToday: -40, dueInDays: 10, paymentRatio: 1, items: [0, 6, 8] },
  { code: 'VOID-UNSENT', label: 'Void Invoice', storedStatus: 'void', daysFromToday: -5, dueInDays: 14, paymentRatio: 0, items: [3, 9] },
  { code: 'WRITEOFF-BADDEBT', label: 'Write Off', storedStatus: 'write_off', daysFromToday: -75, dueInDays: -40, paymentRatio: 0, items: [1, 4, 5] },
  { code: 'SENT-HIGHVALUE', label: 'Sent High Value', storedStatus: 'sent', daysFromToday: -7, dueInDays: 20, paymentRatio: 0, items: [1, 1, 2, 6] },
  { code: 'OVERDUE-HIGHVALUE', label: 'Overdue High Value', storedStatus: 'sent', daysFromToday: -32, dueInDays: -12, paymentRatio: 0, items: [2, 2, 7] },
  { code: 'PARTIAL-MULTIPAY', label: 'Partial Multi Payment', storedStatus: 'partially_paid', daysFromToday: -28, dueInDays: 3, paymentRatio: 0.55, items: [0, 4, 8, 9] },
  { code: 'PAID-SMALL', label: 'Paid Small Ticket', storedStatus: 'paid', daysFromToday: -3, dueInDays: 5, paymentRatio: 1, items: [9, 9, 4] },
  { code: 'DRAFT-RETAINER', label: 'Draft Retainer', storedStatus: 'draft', daysFromToday: 0, dueInDays: 30, paymentRatio: 0, items: [2, 5, 7] },
];

const pickQuantity = (position) => [1, 2, 3, 1, 4][position % 5];

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

async function findUserAndOrg(email) {
  const user = await findUserByEmail(email);
  if (!user) throw new Error(`User ${email} not found`);

  const { data: memberships, error } = await supabase
    .from('organization_users')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .limit(1);

  if (error) throw error;
  if (!memberships?.length) throw new Error(`No organization found for ${email}`);

  return { userId: user.id, orgId: memberships[0].organization_id, role: memberships[0].role };
}

function withDateOffset(daysFromToday) {
  const date = new Date();
  date.setHours(10, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date;
}

function buildProducts(orgId) {
  return productsCatalog.map((product, index) => ({
    ...product,
    organization_id: orgId,
    status: 'active',
    sku: `SKU-STRESS-${String(index + 1).padStart(3, '0')}`,
    stock: 25 + index * 3,
    reorder_level: 4,
  }));
}

function buildInvoicePayloads(orgId, customers, products) {
  const invoices = [];
  const invoiceItems = [];
  const payments = [];

  scenarioDefinitions.forEach((scenario, index) => {
    const customer = customers[index % customers.length];
    const issueDate = withDateOffset(scenario.daysFromToday);
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + scenario.dueInDays);

    let subtotal = 0;
    const itemRows = scenario.items.map((productIndex, itemIndex) => {
      const product = products[productIndex % products.length];
      const quantity = pickQuantity(index + itemIndex);
      const lineSubtotal = product.price * quantity;
      const cgst = Number((lineSubtotal * 0.09).toFixed(2));
      const sgst = Number((lineSubtotal * 0.09).toFixed(2));
      subtotal += lineSubtotal;

      return {
        productId: product.id,
        description: `${product.name} - ${scenario.label}`,
        quantity,
        price: product.price,
        unit: product.unit,
        hsn_code: product.hsn_code,
        tax_rate: 18,
        taxable_value: lineSubtotal,
        cgst_rate: 9,
        sgst_rate: 9,
        igst_rate: 0,
        cgst_amount: cgst,
        sgst_amount: sgst,
        igst_amount: 0,
        is_exempt: false,
        discount_percent: 0,
        sort_order: itemIndex,
        organization_id: orgId,
      };
    });

    const taxAmount = Number((subtotal * 0.18).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));
    const amountPaid = Number((total * scenario.paymentRatio).toFixed(2));
    const balanceDue = Number((total - amountPaid).toFixed(2));

    const invoice = {
      organization_id: orgId,
      customer_id: customer.id,
      invoiceNumber: `ST-${String(index + 1).padStart(3, '0')}-${scenario.code}`,
      buyer: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        gstin: customer.gstin,
        state: customer.state,
        city: customer.city,
      },
      project_name: scenario.label,
      subtotal,
      taxAmount,
      taxRate: 18,
      taxType: 'GST',
      total,
      amount_paid: amountPaid,
      net_receivable: total,
      status: scenario.storedStatus,
      date: issueDate.toISOString(),
      dueDate: dueDate.toISOString(),
      createdAt: issueDate.toISOString(),
      updatedAt: new Date().toISOString(),
      notes: `${scenario.label} scenario for invoice status testing. Expected display state derives from stored status ${scenario.storedStatus} with balance due ${balanceDue}.`,
      discount: 0,
      discount_amount: 0,
      shipping: 0,
      cgst_amount: Number((subtotal * 0.09).toFixed(2)),
      sgst_amount: Number((subtotal * 0.09).toFixed(2)),
      igst_amount: 0,
      gst_type: 'cgst_sgst',
      is_gst_registered: true,
      reverse_charge: false,
      tds_applicable: false,
      tds_rate: 0,
      tds_amount: 0,
      round_off: 0,
      follow_up_count: scenario.storedStatus === 'sent' && scenario.dueInDays < 0 ? 2 : 0,
      persona: 'solopreneur',
    };

    invoices.push(invoice);
    invoiceItems.push(itemRows);

    if (amountPaid > 0) {
      const split = scenario.code === 'PARTIAL-MULTIPAY' ? [0.3, 0.25] : [1];
      let paidAllocated = 0;

      split.forEach((ratio, paymentIndex) => {
        let paymentAmount;
        if (paymentIndex === split.length - 1) {
          paymentAmount = Number((amountPaid - paidAllocated).toFixed(2));
        } else {
          paymentAmount = Number((amountPaid * ratio).toFixed(2));
          paidAllocated += paymentAmount;
        }

        const paymentDate = new Date(issueDate);
        paymentDate.setDate(paymentDate.getDate() + 2 + paymentIndex * 5);

        payments.push({
          invoiceNumber: invoice.invoiceNumber,
          customer_id: customer.id,
          amount: paymentAmount,
          date: paymentDate.toISOString(),
          createdAt: paymentDate.toISOString(),
          method: paymentIndex % 2 === 0 ? 'upi' : 'bank_transfer',
          payment_mode: paymentIndex % 2 === 0 ? 'upi' : 'neft',
          reference_number: `PAY-${scenario.code}-${paymentIndex + 1}`,
          notes: `Payment ${paymentIndex + 1} for ${scenario.label}`,
          status: 'completed',
          organization_id: orgId,
        });
      });
    }
  });

  return { invoices, invoiceItems, payments };
}

async function seedInvoices() {
  const { orgId, role } = await findUserAndOrg(targetEmail);
  console.log(`Organization: ${orgId} (${role})`);

  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('organization_id', orgId)
    .order('createdAt', { ascending: true });

  if (customerError) throw customerError;
  if (!customers?.length) throw new Error('No customers found. Seed customers first.');

  console.log('Clearing existing invoice data...');
  await supabase.from('payments').delete().eq('organization_id', orgId);
  await supabase.from('invoice_items').delete().eq('organization_id', orgId);
  await supabase.from('invoices').delete().eq('organization_id', orgId);
  await supabase.from('products').delete().eq('organization_id', orgId);

  console.log('Creating invoice products...');
  const { data: products, error: productError } = await supabase
    .from('products')
    .insert(buildProducts(orgId))
    .select();

  if (productError) throw productError;

  const { invoices, invoiceItems, payments } = buildInvoicePayloads(orgId, customers, products);

  console.log(`Creating ${invoices.length} invoices across status scenarios...`);
  const { data: insertedInvoices, error: invoiceError } = await supabase
    .from('invoices')
    .insert(invoices)
    .select('id, invoiceNumber');

  if (invoiceError) throw invoiceError;

  const lineItemsPayload = [];
  insertedInvoices.forEach((invoice, index) => {
    invoiceItems[index].forEach((item) => {
      lineItemsPayload.push({ ...item, invoiceId: invoice.id });
    });
  });

  console.log(`Creating ${lineItemsPayload.length} invoice items...`);
  const { error: itemsError } = await supabase
    .from('invoice_items')
    .insert(lineItemsPayload);

  if (itemsError) throw itemsError;

  const invoiceIdMap = new Map(insertedInvoices.map((invoice) => [invoice.invoiceNumber, invoice.id]));
  const paymentsPayload = payments.map((payment) => ({
    ...payment,
    invoiceId: invoiceIdMap.get(payment.invoiceNumber),
  }));

  console.log(`Creating ${paymentsPayload.length} payments...`);
  const { error: paymentsError } = await supabase
    .from('payments')
    .insert(paymentsPayload.map(({ invoiceNumber, ...payment }) => payment));

  if (paymentsError) throw paymentsError;

  console.log('\nInvoice stress dataset ready.');
  console.log(`Customers available: ${customers.length}`);
  console.log(`Products created: ${products.length}`);
  console.log(`Invoices created: ${insertedInvoices.length}`);
  console.log(`Invoice items created: ${lineItemsPayload.length}`);
  console.log(`Payments created: ${paymentsPayload.length}`);
  console.log('\nScenario coverage:');
  scenarioDefinitions.forEach((scenario, index) => {
    console.log(`${index + 1}. ${scenario.code}`);
  });
}

seedInvoices().catch((error) => {
  console.error(`Invoice stress seeding failed: ${error.message}`);
  process.exit(1);
});
