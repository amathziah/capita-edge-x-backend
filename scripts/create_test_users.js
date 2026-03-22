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
    { email: 'solo@capita.test', persona: 'solopreneur', company: 'Solo Ventures' },
    { email: 'agency@capita.test', persona: 'services_firm', company: 'Agile Agency' },
    { email: 'saas@capita.test', persona: 'subscription', company: 'Cloud Scale Inc' },
    { email: 'ecom@capita.test', persona: 'ecommerce', company: 'Global Goods' },
    { email: 'ca@capita.test', persona: 'ca_firm', company: 'Elite Accounting' }
];

const password = 'CapitaTest123!';

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
            console.log(`Setting persona: ${userDef.persona}`);
            const { error: profileError } = await supabase
                .from('profiles')
                .upsert({
                    id: userId,
                    business_type: userDef.persona
                });

            if (profileError) {
                console.error(`❌ Profile upsert error for ${userDef.email} (Persona: ${userDef.persona}):`, profileError.message);
                console.error('Check constraint "profiles_business_type_check" might be rejecting this value.');
            } else {
                console.log('✅ Profile created/updated.');
            }

            // 3. Find or Create Organization
            const slug = userDef.company.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, '');
            
            // Check if user is already linked to ANY org
            const { data: existingLinks } = await supabase
                .from('organization_users')
                .select('organization_id')
                .eq('user_id', userId)
                .limit(1);

            let orgId;

            if (existingLinks && existingLinks.length > 0) {
                orgId = existingLinks[0].organization_id;
                console.log(`User already linked to Org ID: ${orgId}.`);
            } else {
                // Check if org with this slug exists
                const { data: existingOrg } = await supabase
                    .from('organizations')
                    .select('id')
                    .eq('slug', slug)
                    .maybeSingle();

                if (existingOrg) {
                    orgId = existingOrg.id;
                    console.log(`Organization with slug "${slug}" already exists (ID: ${orgId}).`);
                } else {
                    // Create Organization
                    const { data: org, error: orgError } = await supabase
                        .from('organizations')
                        .insert([{
                            name: userDef.company,
                            slug: slug,
                            plan_tier: 'free'
                        }])
                        .select()
                        .single();

                    if (orgError) {
                        console.error(`❌ Org creation failed for ${userDef.email}:`, orgError.message);
                        throw orgError;
                    }
                    orgId = org.id;
                    console.log(`Organization created: ${org.name} (ID: ${orgId})`);
                }

                // Link User as Owner
                const { error: linkError } = await supabase
                    .from('organization_users')
                    .insert([{
                        organization_id: orgId,
                        user_id: userId,
                        role: 'owner'
                    }]);

                if (linkError) {
                    if (linkError.message.includes('duplicate key')) {
                        console.log('User already linked to this organization.');
                    } else {
                        console.error('❌ Link error:', linkError.message);
                        throw linkError;
                    }
                } else {
                    console.log('User linked as owner.');
                }
            }

            // 4. Seed Default Configs (Idempotent)
            const { data: existingConfig } = await supabase
                .from('organization_configs')
                .select('organization_id')
                .eq('organization_id', orgId)
                .maybeSingle();

            if (!existingConfig) {
                await supabase.from('organization_configs').insert([
                    {
                        organization_id: orgId,
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
