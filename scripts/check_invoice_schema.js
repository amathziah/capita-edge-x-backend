import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function checkSchema() {
    console.log("Common Supabase column names for tax: tax_amount, taxAmount, tax, tax_rate, tax_total");

    const columnsToTest = ['tax_amount', 'taxAmount', 'tax', 'tax_total', 'tax_rate'];

    for (const col of columnsToTest) {
        const payload = {};
        payload[col] = 0;

        const { error } = await supabase.from('invoices').insert([payload]);

        if (error && error.message.includes(`Could not find the '${col}' column`)) {
            console.log(`❌ ${col} does NOT exist.`);
        } else if (error && error.code !== 'PGRST204') {
            console.log(`✅ ${col} EXISTS! (failed with different error: ${error.message})`);
            return;
        } else if (!error) {
            console.log(`✅ ${col} EXISTS! (Success or different error)`);
            return;
        }
    }
}

checkSchema();
