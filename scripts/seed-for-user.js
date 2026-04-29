import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://enlswcufkjoemxtjtgiu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubHN3Y3Vma2pvZW14dGp0Z2l1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTE2MTIwOSwiZXhwIjoyMDg0NzM3MjA5fQ.hob_s0b2z2XKAxjzCddohnGkTtyvuP4vnH6E1R0Uq1U'
);

const ORG_ID = 'f2f6add9-107d-419f-b65f-155800aa572a';
const USER_ID = '31587d88-88c0-412e-853b-1cd1fa36d07d';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomDate = (monthsAgo) => {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return new Date(d.getTime() + Math.random() * (Date.now() - d.getTime())).toISOString();
};

const states = ['Maharashtra', 'Karnataka', 'Delhi', 'Haryana', 'Tamil Nadu', 'Gujarat', 'Telangana'];
const cities = {
  'Maharashtra': ['Mumbai', 'Pune', 'Nagpur'],
  'Karnataka': ['Bangalore', 'Mysore', 'Hubli'],
  'Delhi': ['New Delhi', 'Delhi'],
  'Haryana': ['Gurgaon', 'Faridabad'],
  'Tamil Nadu': ['Chennai', 'Coimbatore'],
  'Gujarat': ['Ahmedabad', 'Surat'],
  'Telangana': ['Hyderabad']
};

const companyNames = [
  'Pixel Republic Studio', 'BlueSky Marketing', 'TechFlow Solutions', 'Nexus Creatives Pvt Ltd',
  'Craft & Canvas Co', 'Spark Digital Agency', 'Vega Consulting Pvt', 'Summit Retail Pvt Ltd',
  'Horizon Builders Ltd', 'Indus Fintech Pvt Ltd', 'Aryan Exports Pvt Ltd', 'CloudNine Systems',
  'Greenleaf Organic Foods', 'Titan Logistics Pvt', 'Zephyr Media Works', 'Nova Analytics Pvt',
  'Blossom Events Pvt', 'IronBridge Infrastructure', 'Stellar Pharma Ltd', 'Maple Edtech Pvt',
  'Orbit Solutions Pvt', 'Kiran Auto Parts Ltd', 'Falcon Security Services', 'Prism Design Studio',
  'Atlas Freight Pvt Ltd', 'Zenith Agro Products', 'Coral Reef Hospitality', 'Vortex Software Pvt',
  'Sunrise Healthcare Pvt', 'Dawnlight Textiles Ltd',
];

const notes = [
  'Prompt payer. Prefers email invoices.',
  'Occasionally delays by 5-7 days. Always pays eventually.',
  'Requires GST invoice with GSTIN on every bill.',
  'Key account. Priority support customer.',
  'New client onboarded this quarter.',
  'Prefers UPI payment mode.',
  'Large volume orders. Negotiate rates annually.',
  'Referred by Pixel Republic Studio.',
];

function generateCustomers(orgId, userId) {
  return companyNames.map((name, i) => {
    const state = pick(states);
    const city = pick(cities[state]);
    const panChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const pan = `ABCDE${rNum(1000, 9999)}F`;
    const gstin = `${String(rNum(1, 36)).padStart(2, '0')}${pan}1Z5`;
    const avgDays = rNum(5, 55);
    const lateCount = rNum(0, 8);
    const totalInvoiced = rNum(20000, 500000);
    const totalPaid = Math.round(totalInvoiced * (rNum(60, 100) / 100));

    return {
      organization_id: orgId,
      user_id: userId,
      name,
      email: `accounts@${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}.in`,
      phone: `+91-${rNum(9000000000, 9999999999)}`,
      address: `${rNum(1, 999)} Business Park, Sector ${rNum(1, 20)}, ${city}`,
      city,
      state,
      pincode: `${rNum(100000, 800000)}`,
      country: 'India',
      gstin,
      pan,
      taxId: gstin,
      avg_payment_days: avgDays,
      avg_days_to_pay: avgDays,
      total_invoiced_lifetime: totalInvoiced,
      total_paid_lifetime: totalPaid,
      late_payment_count: lateCount,
      risk_score: lateCount >= 5 ? 'red' : lateCount >= 2 ? 'yellow' : 'green',
      communication_style: pick(['formal', 'casual', 'concise']),
      preferred_send_time: pick(['09:00:00', '14:30:00', '17:00:00']),
      notes: pick(notes),
      createdAt: randomDate(rNum(1, 12)),
      updatedAt: new Date().toISOString(),
    };
  });
}

async function main() {
  console.log(`🧹 Clearing existing customers for org ${ORG_ID}...`);
  const { error: delErr } = await supabase.from('customers').delete().eq('organization_id', ORG_ID);
  if (delErr) console.warn('⚠️  Delete warning:', delErr.message);

  console.log('🔄 Seeding 30 realistic customers...');
  const customers = generateCustomers(ORG_ID, USER_ID);
  const { data, error } = await supabase.from('customers').insert(customers).select('id, name, risk_score');

  if (error) {
    console.error('❌ Insert failed:', error.message);
    process.exit(1);
  }

  console.log(`\n✅ Seeded ${data.length} customers:`);
  data.forEach(c => console.log(`   • ${c.name} (${c.risk_score})`));
}

main().catch(e => { console.error(e); process.exit(1); });
