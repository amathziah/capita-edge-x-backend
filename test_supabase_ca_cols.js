import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log('Fetching columns for "ca_client_relationships"...');
    // We can use a query that fails if column doesn't exist, or just check what's returned
    // But since it's empty, we need another way.
    // Let's try to select specific columns and see if they work.
    const { error } = await supabase
        .from('ca_client_relationships')
        .select('ca_organization_id, client_organization_id, status')
        .limit(0);

    if (error) {
        console.error('❌ Column check failed:', error.message);
    } else {
        console.log('✅ Columns exist!');
    }
}

test();
