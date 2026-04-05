import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'jamathziah@gmail.com';
const PASSWORD = 'password123'; // Default testing password

// Generators
const randomDate = (m, e = 0) => {
    const d = new Date(); d.setMonth(d.getMonth() - m);
    return new Date(d.getTime() + Math.random() * (Date.now() - d.getTime())).toISOString();
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rNum = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Generate 50 realistic Indian B2B customers
function generateCustomers(orgId) {
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
    
    const customers = [];
    for (let i = 1; i <= 50; i++) {
        const state = pick(states);
        const city = pick(cities[state]);
        const pan = `ABCDE${rNum(1000, 9999)}F`;
        const gstin = `${rNum(10, 36)}${pan}1Z5`;
        
        customers.push({
            organization_id: orgId,
            name: `Partner Corp Pvt Ltd ${i}`,
            email: `accounts@partnercorp${i}.in`,
            phone: `+91-${rNum(90000, 99999)}${rNum(10000, 99999)}`,
            address: `${rNum(1, 999)} Industrial Area, Phase ${rNum(1, 4)}, ${city}`,
            gstin: gstin,
            pan: pan,
            taxId: gstin,
            state: state,
            city: city,
            pincode: `${rNum(110000, 800000)}`,
            country: 'India',
            communication_style: pick(['formal', 'casual', 'concise']),
            avg_days_to_pay: rNum(5, 45),
            preferred_send_time: pick(['09:00:00', '14:30:00', '17:00:00']),
            notes: `Auto-generated B2B partner #${i}. Highly reliable client.`,
            createdAt: randomDate(6),
            updatedAt: new Date().toISOString(),
        });
    }
    return customers;
}

async function main() {
    console.log('🔄 Creating User & Organization...');
    
    // 1. Create User
    let { data: { user }, error: userErr } = await supabase.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: 'Capita User' }
    });

    if (userErr && userErr.message.includes('already been registered')) {
        console.log('User already registered. Fetching...');
        const { data: list } = await supabase.auth.admin.listUsers();
        user = list.users.find(u => u.email === EMAIL);
    } else if (userErr) {
        throw new Error(`Failed to create user: ${userErr.message}`);
    }

    console.log(`✅ User ID: ${user.id}`);

    // 2. Setup Organization
    let { data: orgs } = await supabase.from('organization_users').select('organization_id').eq('user_id', user.id);
    let orgId;

    if (!orgs || orgs.length === 0) {
        // Create Org manually
        const { data: newOrg, error: orgErr } = await supabase.from('organizations')
            .insert([{ name: 'Malika Consulting', plan_tier: 'free' }])
            .select().single();
            
        if (orgErr) throw new Error(orgErr.message);
        orgId = newOrg.id;

        // Link User
        await supabase.from('organization_users').insert([{
            organization_id: orgId,
            user_id: user.id,
            role: 'owner'
        }]);

        // Default Config
        await supabase.from('organization_configs').insert([{
            organization_id: orgId,
            timezone: 'Asia/Kolkata',
            currency: 'INR'
        }]);

        console.log(`✅ Created Org: ${orgId}`);
    } else {
        orgId = orgs[0].organization_id;
        console.log(`✅ Found Org: ${orgId}`);
    }

    // 3. Seed 50 Customers
    console.log('\n🧹 Clearing existing customers...');
    await supabase.from('customers').delete().eq('organization_id', orgId);

    console.log('🔄 Generating 50 precise customer records...');
    const customerData = generateCustomers(orgId);
    
    const { count, error } = await supabase.from('customers').insert(customerData).select('id');
    
    if (error) {
        throw new Error(`Failed to seed customers: ${error.message}`);
    }

    console.log(`\n🎉 Success! Seeded 50 detailed B2B customers for ${EMAIL}.`);
    console.log(`🔑 You can login via the frontend using:`);
    console.log(`   Email: ${EMAIL}`);
    console.log(`   Password: ${PASSWORD}\n`);
}

main().catch(err => {
    console.error('💥 Script Error:', err.message);
    process.exit(1);
});
