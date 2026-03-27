import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL or Key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log('Testing Supabase query on "customers"...');
    // Using a mock org ID that likely exists or just see if the query structure is valid
    const { data, error, count } = await supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .limit(1);

    if (error) {
        console.error('❌ Query failed:', error);
    } else {
        console.log('✅ Query succeeded!');
        console.log('Count:', count);
        console.log('Data sample:', data[0]);
    }
}

test();
