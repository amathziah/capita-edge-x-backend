import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.log('Testing Supabase query on "ca_client_relationships"...');
    const { data, error } = await supabase
        .from('ca_client_relationships')
        .select('*')
        .limit(1);

    if (error) {
        console.error('❌ Query failed:', error);
    } else {
        console.log('✅ Query succeeded!');
        console.log('Data sample:', data[0]);
    }
}

test();
