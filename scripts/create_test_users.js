import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const testUsers = [
    { email: 'solo@malika.test', persona: 'solopreneur', company: 'Solo Ventures' },
    { email: 'agency@malika.test', persona: 'agency', company: 'Agile Agency' },
    { email: 'saas@malika.test', persona: 'saas', company: 'Cloud Scale Inc' },
    { email: 'ecom@malika.test', persona: 'ecommerce', company: 'Global Goods' },
    { email: 'ca@malika.test', persona: 'ca', company: 'Elite Accounting' }
];

const password = 'MalikaTest123!';

async function createTestUsers() {
    console.log('🚀 Starting Test User Generation...');

    // Get current users once
    const { data: { users: allUsers }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
        console.error('Failed to list users:', listError.message);
        process.exit(1);
    }

    for (const userDef of testUsers) {
        try {
            console.log(`\n--- Processing: ${userDef.email} (${userDef.persona}) ---`);

            let userId;
            const existingUser = allUsers.find(u => u.email === userDef.email);

            if (existingUser) {
                userId = existingUser.id;
                console.log(`User already exists with ID: ${userId}`);
            } else {
                // 1. Create User
                const { data: userData, error: userError } = await supabase.auth.admin.createUser({
                    email: userDef.email,
                    password: password,
                    email_confirm: true,
                    user_metadata: { company_name: userDef.company }
                });

                if (userError) throw userError;
                userId = userData.user.id;
                console.log(`User created with ID: ${userId}`);
            }

            // 2. Create Profile
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                    id: userId,
                    business_type: userDef.persona
                });

            if (profileError) {
                console.warn(`Profile upsert error for ${userDef.email}:`, profileError.message);
            } else {
                console.log('Profile created/updated.');
            }

            // 3. Check for existing organization
            const { data: existingOrgUsers } = await supabase
                .from('organization_users')
                .select('organization_id')
                .eq('user_id', userId)
                .limit(1);

            if (existingOrgUsers && existingOrgUsers.length > 0) {
                console.log(`Organization already linked (ID: ${existingOrgUsers[0].organization_id}). Skipping creation.`);
            } else {
                // 4. Create Organization
                const { data: org, error: orgError } = await supabase
                    .from('organizations')
                    .insert([{
                        name: userDef.company,
                        slug: userDef.company.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, ''),
                        plan_tier: 'free'
                    }])
                    .select()
                    .single();

                if (orgError) throw orgError;
                console.log(`Organization created: ${org.name}`);

                // 5. Link User as Owner
                const { error: linkError } = await supabase
                    .from('organization_users')
                    .insert([{
                        organization_id: org.id,
                        user_id: userId,
                        role: 'owner'
                    }]);

                if (linkError) throw linkError;
                console.log('User linked as owner.');

                // 6. Seed Default Configs
                await supabase.from('organization_configs').insert([
                    {
                        organization_id: org.id,
                        business_name: userDef.company,
                        currency: 'INR',
                        tax_label: 'GST',
                        invoice_prefix: 'INV-'
                    }
                ]);
                console.log('Default configs seeded.');
            }

        } catch (error) {
            console.error(`Error processing ${userDef.email}:`, error.message);
        }
    }

    console.log('\n✅ Test User Generation Complete!');
}

createTestUsers();
