
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createTestUser() {
    const email = 'test@example.com';
    const password = 'password123';

    console.log(`\n🔄 Attempting to create user: ${email}`);

    // 1. Check if user exists
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
        console.error('❌ Error listing users:', listError.message);
        return;
    }

    let user = users.find(u => u.email === email);
    let userId;

    if (user) {
        console.log('⚠️ User already exists.');
        userId = user.id;

        // Optional: Update password to ensure it matches
        const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password });
        if (updateError) console.error('❌ Failed to update password:', updateError.message);
        else console.log('✅ Password updated to default.');

    } else {
        // Create new user
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true
        });

        if (createError) {
            console.error('❌ Error creating user:', createError.message);
            return;
        }
        console.log('✅ User created successfully.');
        user = newUser.user;
        userId = newUser.user.id;
    }

    console.log(`👤 User ID: ${userId}`);

    // 2. setup Organization (Best Effort)
    // We check if 'organizations' table exists by trying a select
    // If this fails, we know the DB migration is missing.

    console.log('\n🔄 Checking Organization Schema...');

    // Helper to check table existence via simple query
    const { error: tableCheckError } = await supabase.from('organizations').select('count').limit(1);

    if (tableCheckError) {
        console.warn(`⚠️ 'organizations' table check failed: ${tableCheckError.message}`);
        console.warn('ℹ️  Skipping organization setup. Ensure database migrations are applied.');
    } else {
        // Create Organization
        const orgName = 'Test Organization';
        //Check if org exists
        // Assuming 'organizations' table has 'name'
        // If we don't know schema, this is risky, but standard for this codebase seems to be name/id.

        const { data: existingOrgs } = await supabase.from('organizations').select('*').limit(1);

        let orgId;
        if (existingOrgs && existingOrgs.length > 0) {
            console.log(`ℹ️  Using existing organization: ${existingOrgs[0].name || existingOrgs[0].id}`);
            orgId = existingOrgs[0].id;
        } else {
            const { data: newOrg, error: createOrgError } = await supabase
                .from('organizations')
                .insert([{ name: orgName }])
                .select()
                .single();

            if (createOrgError) {
                console.error('❌ Failed to create organization:', createOrgError.message);
            } else {
                console.log('✅ Organization created.');
                orgId = newOrg.id;
            }
        }

        if (orgId) {
            // Link User
            const { error: linkError } = await supabase
                .from('organization_users')
                .upsert({
                    organization_id: orgId,
                    user_id: userId,
                    role: 'owner'
                });

            if (linkError) console.error('❌ Failed to link user to organization:', linkError.message);
            else console.log('✅ User linked to organization.');
        }
    }
}

createTestUser();
