import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findOrg() {
    const email = 'test@example.com';

    // 1. Get User ID
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    if (userError) {
        console.error('Error listing users:', userError);
        return;
    }

    const user = users.find(u => u.email === email);
    if (!user) {
        console.error(`User ${email} not found`);
        return;
    }

    console.log(`Found User ID: ${user.id}`);

    // 2. Get Organization for User
    const { data: orgUsers, error: orgError } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', user.id);

    if (orgError) {
        console.error('Error finding organization:', orgError);
        return;
    }

    if (orgUsers && orgUsers.length > 0) {
        console.log(`organization_id=${orgUsers[0].organization_id}`);
    } else {
        console.log('No organization found for this user.');
    }
}

findOrg();
