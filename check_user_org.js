
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUserOrg() {
    const email = 'test@example.com';
    console.log(`Checking orgs for ${email}...`);

    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
        console.log('User not found!');
        return;
    }

    console.log(`User ID: ${user.id}`);

    const { data: orgUsers, error } = await supabase
        .from('organization_users')
        .select('*')
        .eq('user_id', user.id);

    if (error) {
        console.error('Error fetching organization_users:', error);
    } else {
        console.log('Organization Users entries:', orgUsers);
    }

    const { data: orgs } = await supabase.from('organizations').select('*');
    console.log('All Organizations:', orgs);
}

checkUserOrg();
