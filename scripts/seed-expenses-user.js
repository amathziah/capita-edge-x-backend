import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://enlswcufkjoemxtjtgiu.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U';

const ORG_ID = 'f2f6add9-107d-419f-b65f-155800aa572a';
const USER_ID = '31587d88-88c0-412e-853b-1cd1fa36d07d';

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rAmt = (min, max) => Math.round((Math.random() * (max - min) + min) / 10) * 10;

function daysAgo(n) {
  const d = new Date('2026-04-29');
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

const expenses = [
  // Cloud & Infrastructure
  { description: 'AWS EC2 + S3 — Monthly compute & storage', category: 'Cloud Hosting', vendor_name: 'Amazon Web Services', amount: 14160, gst_amount: 2160, date: daysAgo(3), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'DigitalOcean Droplets — Dev & staging servers', category: 'Cloud Hosting', vendor_name: 'DigitalOcean', amount: 4720, gst_amount: 720, date: daysAgo(33), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Cloudflare Pro Plan — CDN & DDoS protection', category: 'Cloud Hosting', vendor_name: 'Cloudflare', amount: 2360, gst_amount: 360, date: daysAgo(63), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'AWS RDS PostgreSQL — Production database', category: 'Cloud Hosting', vendor_name: 'Amazon Web Services', amount: 9440, gst_amount: 1440, date: daysAgo(93), payment_mode: 'Credit Card', is_itc_eligible: true },

  // Software & Tools
  { description: 'Figma Organisation Plan — UI/UX design tools', category: 'Software & Tools', vendor_name: 'Figma Inc.', amount: 5900, gst_amount: 900, date: daysAgo(8), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'GitHub Teams — Source control & CI/CD', category: 'Software & Tools', vendor_name: 'GitHub Inc.', amount: 4130, gst_amount: 630, date: daysAgo(15), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Notion Team Plan — Documentation & project tracking', category: 'Software & Tools', vendor_name: 'Notion Labs', amount: 2950, gst_amount: 450, date: daysAgo(38), payment_mode: 'UPI', is_itc_eligible: true },
  { description: 'Slack Pro — Team communication', category: 'Software & Tools', vendor_name: 'Slack Technologies', amount: 3540, gst_amount: 540, date: daysAgo(68), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Adobe Creative Cloud — Marketing design assets', category: 'Software & Tools', vendor_name: 'Adobe Systems', amount: 6490, gst_amount: 990, date: daysAgo(98), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Postman Pro — API testing & documentation', category: 'Software & Tools', vendor_name: 'Postman Inc.', amount: 1770, gst_amount: 270, date: daysAgo(128), payment_mode: 'Credit Card', is_itc_eligible: true },

  // Freelancer Payments
  { description: 'Arjun Mehta — Full-stack dev (React + Node.js)', category: 'Freelancer Payments', vendor_name: 'Arjun Mehta', amount: 45000, gst_amount: 0, date: daysAgo(5), payment_mode: 'Bank Transfer', is_itc_eligible: false },
  { description: 'Priya Nair — UI/UX designer, 15-day contract', category: 'Freelancer Payments', vendor_name: 'Priya Nair', amount: 32000, gst_amount: 0, date: daysAgo(22), payment_mode: 'Bank Transfer', is_itc_eligible: false },
  { description: 'Siddharth Joshi — Content writer & SEO specialist', category: 'Freelancer Payments', vendor_name: 'Siddharth Joshi', amount: 18000, gst_amount: 0, date: daysAgo(45), payment_mode: 'UPI', is_itc_eligible: false },
  { description: 'Neha Kapoor — Social media management, April', category: 'Freelancer Payments', vendor_name: 'Neha Kapoor', amount: 22000, gst_amount: 0, date: daysAgo(55), payment_mode: 'UPI', is_itc_eligible: false },
  { description: 'Rahul Sharma — DevOps & cloud setup consultation', category: 'Freelancer Payments', vendor_name: 'Rahul Sharma', amount: 38000, gst_amount: 0, date: daysAgo(75), payment_mode: 'Bank Transfer', is_itc_eligible: false },
  { description: 'Aditi Singh — Video editing, product demo', category: 'Freelancer Payments', vendor_name: 'Aditi Singh', amount: 15000, gst_amount: 0, date: daysAgo(88), payment_mode: 'UPI', is_itc_eligible: false },

  // Marketing & Ads
  { description: 'Google Ads — Search campaigns, April', category: 'Marketing & Ads', vendor_name: 'Google LLC', amount: 24780, gst_amount: 3780, date: daysAgo(2), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'LinkedIn Ads — B2B lead generation', category: 'Marketing & Ads', vendor_name: 'LinkedIn India', amount: 18880, gst_amount: 2880, date: daysAgo(32), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Meta Ads — Instagram & Facebook retargeting', category: 'Marketing & Ads', vendor_name: 'Meta Platforms', amount: 14160, gst_amount: 2160, date: daysAgo(62), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Email marketing tool — Mailchimp Teams', category: 'Marketing & Ads', vendor_name: 'Mailchimp', amount: 3540, gst_amount: 540, date: daysAgo(92), payment_mode: 'Credit Card', is_itc_eligible: true },

  // Travel
  { description: 'Delhi–Mumbai flight — Client meeting, Nexus Creatives', category: 'Travel', vendor_name: 'IndiGo Airlines', amount: 8260, gst_amount: 1260, date: daysAgo(10), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Mumbai hotel stay — 2 nights, client visit', category: 'Travel', vendor_name: 'Marriott Mumbai', amount: 11800, gst_amount: 1800, date: daysAgo(10), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Bengaluru–Hyderabad train — TechFlow onsite', category: 'Travel', vendor_name: 'Indian Railways', amount: 2360, gst_amount: 360, date: daysAgo(40), payment_mode: 'UPI', is_itc_eligible: true },
  { description: 'Cab & local transport — Delhi client meetings', category: 'Travel', vendor_name: 'Uber India', amount: 3540, gst_amount: 540, date: daysAgo(12), payment_mode: 'UPI', is_itc_eligible: false },

  // Equipment
  { description: 'MacBook Pro M3 — Developer workstation', category: 'Equipment', vendor_name: 'Apple India', amount: 189200, gst_amount: 28800, date: daysAgo(115), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'LG 27" 4K monitor × 2 — Design team setup', category: 'Equipment', vendor_name: 'LG Electronics India', amount: 47200, gst_amount: 7200, date: daysAgo(110), payment_mode: 'Credit Card', is_itc_eligible: true },
  { description: 'Ergonomic chairs × 3 — Office furniture', category: 'Equipment', vendor_name: 'Featherlite India', amount: 35400, gst_amount: 5400, date: daysAgo(105), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'Logitech MX Keys + MX Master 3 combo × 2', category: 'Equipment', vendor_name: 'Logitech India', amount: 11800, gst_amount: 1800, date: daysAgo(103), payment_mode: 'Credit Card', is_itc_eligible: true },

  // Office & Utilities
  { description: 'Regus co-working space — April desk rental', category: 'Rent', vendor_name: 'Regus India', amount: 28320, gst_amount: 4320, date: daysAgo(1), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'Regus co-working space — March desk rental', category: 'Rent', vendor_name: 'Regus India', amount: 28320, gst_amount: 4320, date: daysAgo(31), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'Tata Power — Office electricity bill, April', category: 'Utilities', vendor_name: 'Tata Power', amount: 4720, gst_amount: 720, date: daysAgo(4), payment_mode: 'UPI', is_itc_eligible: false },
  { description: 'Airtel Broadband — 1 Gbps fiber, April', category: 'Utilities', vendor_name: 'Airtel India', amount: 3068, gst_amount: 468, date: daysAgo(6), payment_mode: 'UPI', is_itc_eligible: true },
  { description: 'Airtel Broadband — 1 Gbps fiber, March', category: 'Utilities', vendor_name: 'Airtel India', amount: 3068, gst_amount: 468, date: daysAgo(36), payment_mode: 'UPI', is_itc_eligible: true },

  // Meals & Entertainment
  { description: 'Team lunch — Q1 review + retrospective', category: 'Meals', vendor_name: 'The Fatty Bao, Bengaluru', amount: 6800, gst_amount: 1020, date: daysAgo(18), payment_mode: 'Credit Card', is_itc_eligible: false },
  { description: 'Client dinner — Pixel Republic Studio', category: 'Meals', vendor_name: 'Olive Beach, Bengaluru', amount: 9400, gst_amount: 1410, date: daysAgo(25), payment_mode: 'Credit Card', is_itc_eligible: false },
  { description: 'Team offsite lunch — Planning Q2 roadmap', category: 'Meals', vendor_name: 'Toit Brewpub, Bengaluru', amount: 8200, gst_amount: 1230, date: daysAgo(50), payment_mode: 'Credit Card', is_itc_eligible: false },

  // Professional Services
  { description: 'CA firm — GST filing & annual compliance review', category: 'Professional Services', vendor_name: 'Mehta & Associates CA', amount: 23600, gst_amount: 3600, date: daysAgo(20), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'Legal retainer — Startup legal advisory, Q1', category: 'Professional Services', vendor_name: 'Khaitan & Co. (Bengaluru)', amount: 35400, gst_amount: 5400, date: daysAgo(85), payment_mode: 'Bank Transfer', is_itc_eligible: true },
  { description: 'Trademark filing — CapitaEdgeX brand registration', category: 'Professional Services', vendor_name: 'IPR Counsel India', amount: 18880, gst_amount: 2880, date: daysAgo(120), payment_mode: 'Bank Transfer', is_itc_eligible: true },
];

async function seed() {
  console.log('Clearing existing expenses for org...');
  const { error: delErr } = await sb.from('expenses').delete().eq('organization_id', ORG_ID);
  if (delErr) { console.error('Delete error:', delErr.message); process.exit(1); }

  const rows = expenses.map((e, i) => ({
    organization_id: ORG_ID,
    user_id: USER_ID,
    description: e.description,
    amount: e.amount,
    category: e.category,
    vendor_name: e.vendor_name,
    date: e.date,
    gst_amount: e.gst_amount,
    is_itc_eligible: e.is_itc_eligible,
    payment_mode: e.payment_mode,
    reference_number: `EXP-${Date.now().toString(36).toUpperCase()}-${i}`,
  }));

  const { data, error } = await sb.from('expenses').insert(rows).select('id');
  if (error) { console.error('Insert error:', error.message); process.exit(1); }

  console.log(`\n✅ Seeded ${data.length} expenses\n`);

  // Summary by category
  const summary = {};
  expenses.forEach(e => { summary[e.category] = (summary[e.category] || 0) + e.amount; });
  console.log('── By Category ──────────────────────');
  Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
    console.log(`  ${cat.padEnd(26)} ₹${amt.toLocaleString('en-IN')}`);
  });
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  console.log(`${''.padEnd(26)}─────────────`);
  console.log(`  ${'TOTAL'.padEnd(24)} ₹${total.toLocaleString('en-IN')}`);
}

seed();
