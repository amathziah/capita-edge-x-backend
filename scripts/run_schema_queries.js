import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function runQueries() {
    const queries = [
        { name: 'invoices', sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'invoices' ORDER BY ordinal_position" },
        { name: 'business_personas', sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'business_personas' ORDER BY ordinal_position" },
        { name: 'users', sql: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position" }
    ];

    for (const q of queries) {
        console.log(`\n--- Result for: ${q.name} ---`);
        // We attempt to use a potential 'run_sql' RPC or similar if available, 
        // but since we don't know if it exists, we'll try to fetch columns via standard SELECT if RPC fails.
        // Actually, let's try to find an RPC that might work or just use the JS client to list columns if possible.
        // Supabase JS doesn't have a direct 'list columns' without RPC.
        
        // Let's try to fetch 1 row and mask the data to just see columns as a fallback
        const { data, error } = await supabase.from(q.name).select('*').limit(1);
        if (error) {
            console.log(`Error or Table Missing for ${q.name}: ${error.message}`);
        } else if (data && data.length > 0) {
            console.log(`Columns found in ${q.name}:`, Object.keys(data[0]));
        } else {
            console.log(`Table ${q.name} exists but is empty.`);
        }
    }
    
    // Attempting raw SQL if we can find any RPC. 
    // Usually 'run_sql' is a common admin helper.
    console.log("\n--- Attempting Raw SQL for exact information_schema results ---");
    for (const q of queries) {
        const { data, error } = await supabase.rpc('run_sql', { sql: q.sql }).catch(() => ({ data: null, error: { message: 'run_sql RPC not found' } }));
        if (data) {
            console.log(`\nDetailed results for ${q.name}:`);
            console.table(data);
        } else {
            console.log(`Direct SQL failed for ${q.name}: ${error?.message || 'Unknown error'}`);
        }
    }
}

runQueries();
