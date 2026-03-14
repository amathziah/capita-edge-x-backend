import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
    console.log("Checking schema via sample data...");
    
    const tables = ['invoices', 'profiles', 'customers', 'products'];
    
    for (const table of tables) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.error(`Error fetching from ${table}:`, error.message);
        } else if (data && data.length > 0) {
            console.log(`Columns in '${table}':`, Object.keys(data[0]));
        } else {
            console.log(`Table '${table}' is empty. Trying to get columns from information_schema if possible...`);
            // Attempting to use a common RPC if it exists
            const { data: cols, error: rpcError } = await supabase.rpc('run_sql', { 
                sql: `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'` 
            }).catch(() => ({ data: null, error: { message: 'RPC run_sql not found' } }));
            
            if (cols) {
                console.log(`Columns in '${table}' (via RPC):`, cols.map(c => c.column_name));
            } else {
                console.log(`Could not get columns for ${table}.`);
            }
        }
    }
}

diagnose();
