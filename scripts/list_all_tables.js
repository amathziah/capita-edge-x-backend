import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function listAll() {
    console.log("Searching all schemas for tables and views...");
    
    // We can use the 'run_sql' approach if we can find it.
    // If not, we can try to guess common schemas.
    const schemas = ['public', 'auth', 'extensions', 'storage'];
    
    for (const schema of schemas) {
        console.log(`\n--- Schema: ${schema} ---`);
        // Note: from() usually assumes public unless configured otherwise,
        // but Supabase JS doesn't easily let you switch schemas for the builder 
        // without custom headers or RPC.
    }
    
    // Let's try the RPC again with proper error handling and NO .catch on the call itself if it's not a true promise (Supabase rpc returns a thenable object)
    try {
        const { data: tables, error } = await supabase.rpc('run_sql', { 
            sql: "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_name IN ('invoices', 'business_personas', 'users', 'profiles') ORDER BY table_schema, table_name" 
        });
        
        if (error) {
            console.error("RPC Error:", error.message);
            // Fallback: try to just fetch from common names
            const { data: profiles } = await supabase.from('profiles').select('*').limit(1);
            if (profiles) console.log("Profiles (public) exists.");
        } else {
            console.table(tables);
            
            // For each table found, get columns
            for (const t of tables) {
                console.log(`\n--- Columns for ${t.table_schema}.${t.table_name} ---`);
                const { data: cols } = await supabase.rpc('run_sql', {
                    sql: `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = '${t.table_schema}' AND table_name = '${t.table_name}' ORDER BY ordinal_position`
                });
                console.table(cols);
            }
        }
    } catch (e) {
        console.error("Unexpected error:", e.message);
    }
}

listAll();
