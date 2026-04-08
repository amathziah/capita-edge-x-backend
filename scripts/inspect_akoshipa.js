import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users.users.find(u => u.email === 'akoshipa@gmail.com');
    if (!user) { console.log('User not found'); return; }
    
    console.log('User ID:', user.id);

    // List all tables we might need to check
    const tables = ['organizations', 'profiles'];
    
    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.log(`Error reading table ${table}:`, error.message);
        } else if (data && data.length > 0) {
            console.log(`Columns in ${table}:`, Object.keys(data[0]));
        } else {
            console.log(`Table ${table} is empty or not accessible.`);
        }
    }

    // Specifically find the organization for this user
    // We already know from aiBudget.service.js that organizations has 'plan_tier'
    // Let's find WHICH organization belongs to Akoshipa.
    // We'll try common owner columns: 'owner_id', 'user_id', 'created_by'
    const { data: orgs } = await supabase.from('organizations').select('*');
    if (orgs) {
        const myOrgs = orgs.filter(o => o.owner_id === user.id || o.user_id === user.id || o.created_by === user.id);
        console.log('Akoshipa Organizations:', myOrgs);
    }
}
run();
