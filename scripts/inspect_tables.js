import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('--- Inspecting Tables ---');

    const tables = ['expenses', 'payments', 'products', 'invoices', 'invoice_items'];

    for (const table of tables) {
        console.log(`\n🔍 Table: ${table}`);
        const { data, error } = await supabase.from(table).select('*').limit(1);

        if (error) {
            console.log(`Error accessing ${table}: ${error.message}`);
        } else if (data.length === 0) {
            console.log(`Table ${table} is empty. Cannot infer structure from data.`);
            // Try to insert a dummy to see errors? No, too risky.
            // We'll rely on common sense naming or client types if empty.
        } else {
            console.log('Sample Row Keys:', Object.keys(data[0]).join(', '));
            console.log('Sample Row:', JSON.stringify(data[0], null, 2));
        }
    }
}

inspect();
