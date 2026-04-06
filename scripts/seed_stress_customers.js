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
const customerCount = Number(process.argv[3] || 20);

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!targetEmail) {
  console.error('Usage: node scripts/seed_stress_customers.js <email> [count]');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const companies = [
  { name: 'Northstar Retail', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  { name: 'Velvet Mango Studio', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  { name: 'Blue Ember Labs', city: 'Hyderabad', state: 'Telangana', pincode: '500081' },
  { name: 'Civic Grain Foods', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  { name: 'Riverframe Media', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  { name: 'SummitOps Consulting', city: 'Gurugram', state: 'Haryana', pincode: '122001' },
  { name: 'Mintline Health', city: 'Kochi', state: 'Kerala', pincode: '682011' },
  { name: 'Signalleaf Education', city: 'Ahmedabad', state: 'Gujarat', pincode: '380009' },
  { name: 'ForgeGrid Systems', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
  { name: 'Orbitlane Logistics', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
  { name: 'HarborPeak Ventures', city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
  { name: 'PixelMint Creative', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001' },
  { name: 'LedgerBloom Finance', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226001' },
  { name: 'VerdeNest Interiors', city: 'Coimbatore', state: 'Tamil Nadu', pincode: '641001' },
  { name: 'PrimeAxis Mobility', city: 'New Delhi', state: 'Delhi', pincode: '110001' },
  { name: 'BrightRoute Travel', city: 'Chandigarh', state: 'Chandigarh', pincode: '160017' },
  { name: 'CoreCask Beverages', city: 'Goa', state: 'Goa', pincode: '403001' },
  { name: 'ZenoCraft Manufacturing', city: 'Surat', state: 'Gujarat', pincode: '395003' },
  { name: 'TidalWave Commerce', city: 'Visakhapatnam', state: 'Andhra Pradesh', pincode: '530002' },
  { name: 'MapleArc Architects', city: 'Bhubaneswar', state: 'Odisha', pincode: '751001' },
];

const contacts = [
  'Aarav Shah', 'Diya Nair', 'Ishaan Gupta', 'Mira Rao', 'Rohan Menon',
  'Kavya Iyer', 'Arjun Bedi', 'Sneha Kapoor', 'Vihaan Reddy', 'Anika Jain',
  'Rahul Desai', 'Neha Pillai', 'Sahil Khanna', 'Pooja Verma', 'Nikhil Das',
  'Aditi Mehta', 'Karan Joshi', 'Ritika Sen', 'Dev Malhotra', 'Tanvi Kulkarni',
];

const styles = ['formal', 'concise', 'casual'];
const sendTimes = ['09:00:00', '11:30:00', '14:00:00', '16:30:00', '18:00:00'];
const segments = ['retail', 'agency', 'technology', 'consulting', 'healthcare', 'education', 'logistics', 'manufacturing'];

const pick = (array, index) => array[index % array.length];

const buildPan = (index) => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = letters[(index * 3) % 26] + letters[(index * 5 + 2) % 26] + letters[(index * 7 + 4) % 26] + letters[(index * 11 + 6) % 26] + letters[(index * 13 + 8) % 26];
  const digits = String(1200 + index).padStart(4, '0');
  return `${prefix}${digits}F`;
};

const stateCodeMap = {
  'Andhra Pradesh': '37',
  Chandigarh: '04',
  Delhi: '07',
  Goa: '30',
  Gujarat: '24',
  Haryana: '06',
  Karnataka: '29',
  Kerala: '32',
  Maharashtra: '27',
  'Madhya Pradesh': '23',
  Odisha: '21',
  Rajasthan: '08',
  'Tamil Nadu': '33',
  Telangana: '36',
  'Uttar Pradesh': '09',
  'West Bengal': '19',
};

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

function generateCustomers(orgId, userId, count) {
  return Array.from({ length: count }, (_, index) => {
    const company = pick(companies, index);
    const contact = pick(contacts, index);
    const pan = buildPan(index + 1);
    const gstin = `${stateCodeMap[company.state] || '27'}${pan}1Z5`;
    const domain = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const createdAt = new Date(Date.now() - (count - index) * 86400000 * 3).toISOString();
    const avgDaysToPay = 7 + (index % 6) * 5;

    return {
      organization_id: orgId,
      user_id: userId,
      name: company.name,
      email: `accounts@${domain}.in`,
      phone: `+91-${String(9000000000 + index * 37921).slice(0, 10)}`,
      address: `${120 + index}, ${company.city} Business Park, Sector ${1 + (index % 9)}`,
      city: company.city,
      state: company.state,
      pincode: company.pincode,
      country: 'India',
      taxId: gstin,
      gstin,
      pan,
      communication_style: pick(styles, index),
      avg_days_to_pay: avgDaysToPay,
      preferred_send_time: pick(sendTimes, index),
      notes: `${contact} manages billing. Segment: ${pick(segments, index)}. Stress-test customer ${index + 1} for collections, reminders, and receivables workflows.`,
      createdAt,
      updatedAt: new Date().toISOString(),
    };
  });
}

async function seedCustomers() {
  const { userId, orgId, role } = await findUserAndOrg(targetEmail);

  console.log(`User: ${userId}`);
  console.log(`Organization: ${orgId} (${role})`);
  console.log(`Clearing existing customers for organization ${orgId}...`);

  const { error: deleteError } = await supabase
    .from('customers')
    .delete()
    .eq('organization_id', orgId);

  if (deleteError) throw deleteError;

  const payload = generateCustomers(orgId, userId, customerCount);
  console.log(`Inserting ${payload.length} detailed customers...`);

  const { data, error } = await supabase
    .from('customers')
    .insert(payload)
    .select('id, name, email, city, state');

  if (error) throw error;

  console.log(`Inserted ${data.length} customers for ${targetEmail}.`);
  data.forEach((customer, index) => {
    console.log(`${index + 1}. ${customer.name} | ${customer.email} | ${customer.city}, ${customer.state}`);
  });
}

seedCustomers().catch((error) => {
  console.error(`Seeding failed: ${error.message}`);
  process.exit(1);
});
