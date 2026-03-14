import { supabase } from '../supabase.js';

async function runDiagnostics() {
    console.log("--- Step 1: Invoices Table Schema ---");
    const { data: invoicesCols, error: err1 } = await supabase.rpc('run_sql', {
        sql_query: `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'invoices'
            ORDER BY ordinal_position;
        `
    }).select();
    
    // Fallback if rpc 'run_sql' doesn't exist
    if (err1) {
        console.log("RPC 'run_sql' failed, trying direct select with limit 0...");
        const { data, error } = await supabase.from('invoices').select('*').limit(0);
        if (error) {
            console.error("Direct select failed:", error.message);
        } else {
            console.log("Columns in 'invoices':", Object.keys(data[0] || {}));
        }
    } else {
        console.table(invoicesCols);
    }

    console.log("\n--- Step 2: business_personas (Profiles) Schema ---");
    const { data: profilesCols, error: err2 } = await supabase.rpc('run_sql', {
        sql_query: `
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'profiles'
            ORDER BY ordinal_position;
        `
    });

    if (err2) {
        const { data, error } = await supabase.from('profiles').select('*').limit(0);
        if (error) {
            console.error("Direct select failed:", error.message);
        } else {
            console.log("Columns in 'profiles':", Object.keys(data[0] || {}));
        }
    } else {
        console.table(profilesCols);
    }
}

runDiagnostics();
