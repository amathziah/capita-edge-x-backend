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
  console.error('Usage: node scripts/seed_stress_context.js <email>');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const expensesCatalog = [
  ['Figma Professional', 'Software & Tools', 1299],
  ['Adobe Creative Cloud', 'Software & Tools', 4499],
  ['AWS Hosting', 'Cloud Hosting', 7800],
  ['Vercel Pro', 'Cloud Hosting', 1900],
  ['Coworking Desk', 'Workspace', 8500],
  ['Internet Fiber', 'Utilities', 1499],
  ['Meta Ads Campaign', 'Marketing', 12000],
  ['Google Workspace', 'Software & Tools', 899],
  ['Freelance Motion Designer', 'Contractors', 18000],
  ['Client Travel', 'Travel', 6200],
  ['CA Filing Support', 'Legal & Accounting', 3500],
  ['Equipment Upgrade', 'Equipment', 27500],
];

const complianceTasks = [
  { type: 'GST', description: 'File GSTR-1 for current cycle', priority: 'high', offsetDays: 4, status: 'pending' },
  { type: 'GST', description: 'File GSTR-3B for current cycle', priority: 'high', offsetDays: 9, status: 'pending' },
  { type: 'TDS', description: 'Deposit TDS collected this month', priority: 'medium', offsetDays: 13, status: 'pending' },
  { type: 'Income Tax', description: 'Review advance tax estimate', priority: 'medium', offsetDays: 22, status: 'pending' },
  { type: 'Regulatory', description: 'Renew MSME and vendor compliance docs', priority: 'low', offsetDays: 31, status: 'pending' },
  { type: 'Audit', description: 'Prepare books and invoices for CA review', priority: 'critical', offsetDays: -2, status: 'pending' },
  { type: 'GST', description: 'Reconcile purchase entries with books', priority: 'medium', offsetDays: -10, status: 'completed' },
  { type: 'Regulatory', description: 'Update business address proof records', priority: 'low', offsetDays: -20, status: 'completed' },
];

const reportSeeds = [
  { type: 'feedback', title: 'Invoice filters feel good with stress data', description: 'Status combinations help validate overdue and partial payment views.', priority: 'low' },
  { type: 'feature_request', title: 'Need invoice ageing buckets on reports', description: 'Aging buckets would make collections reporting much more actionable.', priority: 'medium' },
];

const aiConversationSeeds = [
  {
    title: 'Cash Flow Check',
    messages: [
      { role: 'user', content: 'How much unpaid money is currently stuck in invoices?' },
      { role: 'model', content: 'You have a mix of current, due-today, and overdue invoices. The overdue and partially paid cases need follow-up first because they are most likely to affect this week’s cash flow.' },
    ],
  },
  {
    title: 'Collections Priority',
    messages: [
      { role: 'user', content: 'Which invoices should I follow up on first?' },
      { role: 'model', content: 'Start with the oldest overdue invoices, then partially paid invoices with high remaining balance, then anything due today. Those three groups have the highest collection priority.' },
    ],
  },
  {
    title: 'Expense Review',
    messages: [
      { role: 'user', content: 'Where is most of my spending going this month?' },
      { role: 'model', content: 'Your largest spend categories are software, contractors, and marketing. Those are the easiest areas to review for short-term margin improvement.' },
    ],
  },
];

const maybeIgnoreError = (error) => error && ['PGRST205', '42P01', '42703'].includes(error.code);

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

function isoDayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

async function clearTable(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error && !maybeIgnoreError(error)) throw error;
}

async function upsertOrganizationConfig(orgId) {
  const inventorySettings = {
    owner_name: 'Akoshipa Joseph',
    businessName: 'Akoshipa Studio',
    freelanceCategory: 'Design & Creative',
    customFreelanceCategory: '',
    dailyRate: 8000,
    companyTaxId: '29AKOSH1234F1Z5',
    defaultGstRate: 18,
    paymentTerms: 'Net 15',
    invoiceNotes: 'Thanks for working with Akoshipa Studio.',
    upiId: 'akoshipa@upi',
    bankName: 'HDFC Bank',
    bankAccountNumber: '50200012345678',
    bankIfsc: 'HDFC0000456',
    paymentInstructions: 'Please include the invoice number in the payment reference.',
  };

  const config = {
    organization_id: orgId,
    business_name: 'Akoshipa Studio',
    email: targetEmail,
    phone: '+91-9876501234',
    address: '91 Residency Road, Bengaluru 560025',
    currency: 'INR',
    tax_label: 'GST',
    invoice_prefix: 'ST-',
    payment_terms: 'Net 15',
    footer_text: 'Payments appreciated within due date. For clarifications, reply to this invoice email.',
    invoice_notes: 'Thanks for working with Akoshipa Studio.',
    gstin: '29AKOSH1234F1Z5',
    pan: 'AKOSH1234F',
    company_tax_id: '29AKOSH1234F1Z5',
    state: 'Karnataka',
    city: 'Bengaluru',
    pincode: '560025',
    business_type: 'solopreneur',
    default_due_days: 15,
    auto_follow_up: true,
    follow_up_day_1: 3,
    follow_up_day_2: 7,
    follow_up_day_3: 14,
    dead_stock_threshold_days: 60,
    reorder_alerts_enabled: true,
    mrr_alerts_enabled: true,
    weekly_summary_enabled: true,
    bank_name: 'HDFC Bank',
    bank_account_number: '50200012345678',
    bank_ifsc: 'HDFC0000456',
    upi_id: 'akoshipa@upi',
    bank_details: 'Bank: HDFC Bank\nAccount No: 50200012345678\nIFSC: HDFC0000456',
    payment_instructions: 'Please include the invoice number in the payment reference.',
    msme_number: 'UDYAM-KR-03-0012345',
    lut_number: 'LUTAKOSH2026APR001',
    frn: 'FRN-AK-2026-01',
    inventory_settings: inventorySettings,
  };

  const { error } = await supabase.from('organization_configs').upsert(config);
  if (error && !maybeIgnoreError(error)) throw error;

  const { error: organizationError } = await supabase
    .from('organizations')
    .update({
      name: 'Akoshipa Studio',
      slug: 'akoshipa-studio',
    })
    .eq('id', orgId);

  if (organizationError && !maybeIgnoreError(organizationError)) throw organizationError;

  const settingsVariants = [
    {
      organization_id: orgId,
      businessName: 'Akoshipa Studio',
      companyTaxId: '29AKOSH1234F1Z5',
      currency: 'INR',
      defaultGstRate: 18,
      business_type: 'solopreneur',
      invoiceNotes: 'Thanks for working with Akoshipa Studio.',
      owner_name: 'Akoshipa Joseph',
      upiId: 'akoshipa@upi',
      bankName: 'HDFC Bank',
      bankAccountNumber: '50200012345678',
      bankIfsc: 'HDFC0000456',
    },
    {
      organization_id: orgId,
      business_name: 'Akoshipa Studio',
      company_tax_id: '29AKOSH1234F1Z5',
      currency: 'INR',
      default_gst_rate: 18,
      business_type: 'solopreneur',
      invoice_notes: 'Thanks for working with Akoshipa Studio.',
      owner_name: 'Akoshipa Joseph',
      upi_id: 'akoshipa@upi',
      bank_name: 'HDFC Bank',
      bank_account_number: '50200012345678',
      bank_ifsc: 'HDFC0000456',
    },
  ];

  for (const variant of settingsVariants) {
    const { error: settingsError } = await supabase.from('settings').upsert(variant);
    if (!settingsError) {
      return;
    }
    if (maybeIgnoreError(settingsError)) {
      return;
    }
  }

  console.warn('Skipping settings seed because the table schema differs in this environment.');
}

async function seedExpenses(orgId, userId) {
  await clearTable('expenses', 'organization_id', orgId);

  const payload = Array.from({ length: 30 }, (_, index) => {
    const [description, category, baseAmount] = expensesCatalog[index % expensesCatalog.length];
    const date = new Date();
    date.setDate(date.getDate() - index * 2);

    return {
      organization_id: orgId,
      user_id: userId,
      description: `${description} ${index < 12 ? '' : `#${index - 11}`}`.trim(),
      category,
      amount: baseAmount + (index % 4) * 350,
      date: date.toISOString(),
    };
  });

  const { error } = await supabase.from('expenses').insert(payload);
  if (error) throw error;
  return payload.length;
}

async function seedCompliance(orgId) {
  await clearTable('compliance_tasks', 'organization_id', orgId);

  const payload = complianceTasks.map((task, index) => ({
    organization_id: orgId,
    type: task.type,
    description: task.description,
    due_date: isoDayOffset(task.offsetDays).split('T')[0],
    status: task.status,
    priority: task.priority,
    notes: `Seeded compliance task ${index + 1} for dashboard and notification testing.`,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('compliance_tasks').insert(payload);
  if (error) throw error;
  return payload.length;
}

async function seedReminders(orgId, invoices) {
  await clearTable('reminders', 'organization_id', orgId);

  const targetInvoices = invoices.filter((invoice) => ['sent', 'partially_paid'].includes(invoice.status)).slice(0, 6);
  const payload = targetInvoices.map((invoice, index) => {
    const sentAt = new Date();
    sentAt.setDate(sentAt.getDate() - (index + 1) * 2);

    return {
      organization_id: orgId,
      invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      reminder_type: index % 3 === 0 ? 'follow_up_1' : index % 3 === 1 ? 'follow_up_2' : 'custom',
      scheduled_at: sentAt.toISOString(),
      sent_at: sentAt.toISOString(),
      status: 'sent',
      channel: index % 2 === 0 ? 'email' : 'both',
      message_body: `Follow-up reminder for ${invoice.invoiceNumber}`,
    };
  });

  const { error } = await supabase.from('reminders').insert(payload);
  if (error && !maybeIgnoreError(error)) throw error;
  return error ? 0 : payload.length;
}

async function seedNotifications(orgId, userId) {
  await clearTable('notifications', 'organization_id', orgId);

  const payload = [
    {
      organization_id: orgId,
      user_id: userId,
      type: 'reminder_sent',
      message: 'Reminder was sent for the oldest overdue invoice.',
      metadata: { scope: 'collections' },
    },
    {
      organization_id: orgId,
      user_id: userId,
      type: 'compliance_due',
      message: 'Audit preparation task is already overdue.',
      metadata: { scope: 'compliance' },
    },
  ];

  const { error } = await supabase.from('notifications').insert(payload);
  if (error && !maybeIgnoreError(error)) throw error;
  return error ? 0 : payload.length;
}

async function seedReports(orgId, userId) {
  await clearTable('platform_reports', 'organization_id', orgId);

  const payload = reportSeeds.map((report) => ({
    organization_id: orgId,
    user_id: userId,
    ...report,
    status: 'open',
    metadata: { source: 'stress_seed' },
  }));

  const { error } = await supabase.from('platform_reports').insert(payload);
  if (error && !maybeIgnoreError(error)) throw error;
  return error ? 0 : payload.length;
}

async function seedAiHistory(orgId, userId) {
  await clearTable('ai_chat_messages', 'organization_id', orgId);
  await clearTable('ai_conversations', 'organization_id', orgId);
  await clearTable('ai_requests', 'organization_id', orgId);

  const { data: conversations, error } = await supabase
    .from('ai_conversations')
    .insert(aiConversationSeeds.map((conversation) => ({
      organization_id: orgId,
      user_id: userId,
      title: conversation.title,
      metadata: { source: 'stress_seed' },
    })))
    .select('id, title');

  if (error && !maybeIgnoreError(error)) throw error;
  if (error) return { conversations: 0, messages: 0, requests: 0 };

  const messages = [];
  conversations.forEach((conversation, index) => {
    aiConversationSeeds[index].messages.forEach((message) => {
      messages.push({
        organization_id: orgId,
        user_id: userId,
        conversation_id: conversation.id,
        role: message.role,
        content: message.content,
        data: message.role === 'model' ? { source: 'stress_seed' } : null,
      });
    });
  });

  const { error: messagesError } = await supabase.from('ai_chat_messages').insert(messages);
  if (messagesError && !maybeIgnoreError(messagesError)) throw messagesError;

  const requests = aiConversationSeeds.map((_, index) => ({
    organization_id: orgId,
    user_id: userId,
    model_name: 'gemini-2.5-flash',
    total_tokens: 900 + index * 180,
    cost: 0.08 + index * 0.02,
  }));

  const { error: requestError } = await supabase.from('ai_requests').insert(requests);
  if (requestError && !maybeIgnoreError(requestError)) throw requestError;

  return {
    conversations: conversations.length,
    messages: messagesError ? 0 : messages.length,
    requests: requestError ? 0 : requests.length,
  };
}

async function seedContext() {
  const { userId, orgId, role } = await findUserAndOrg(targetEmail);
  console.log(`Organization: ${orgId} (${role})`);

  const { data: invoices, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, invoiceNumber, customer_id, status')
    .eq('organization_id', orgId)
    .order('date', { ascending: true });

  if (invoiceError) throw invoiceError;
  if (!invoices?.length) throw new Error('No invoices found. Seed invoices first.');

  console.log('Upserting organization config and settings...');
  await upsertOrganizationConfig(orgId);

  console.log('Seeding expenses...');
  const expensesCount = await seedExpenses(orgId, userId);

  console.log('Seeding compliance tasks...');
  const complianceCount = await seedCompliance(orgId);

  console.log('Seeding reminders...');
  const remindersCount = await seedReminders(orgId, invoices);

  console.log('Seeding notifications...');
  const notificationsCount = await seedNotifications(orgId, userId);

  console.log('Seeding platform reports...');
  const reportsCount = await seedReports(orgId, userId);

  console.log('Seeding AI history...');
  const aiCounts = await seedAiHistory(orgId, userId);

  console.log('\nStress context ready.');
  console.log(`Expenses: ${expensesCount}`);
  console.log(`Compliance tasks: ${complianceCount}`);
  console.log(`Reminders: ${remindersCount}`);
  console.log(`Notifications: ${notificationsCount}`);
  console.log(`Platform reports: ${reportsCount}`);
  console.log(`AI conversations: ${aiCounts.conversations}`);
  console.log(`AI messages: ${aiCounts.messages}`);
  console.log(`AI requests: ${aiCounts.requests}`);
}

seedContext().catch((error) => {
  console.error(`Stress context seeding failed: ${error.message}`);
  process.exit(1);
});
