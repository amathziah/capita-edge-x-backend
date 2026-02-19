
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Try loading from root .env if server one fails or vice versa. 
// Assuming script is in server/scripts, root is ../../
const envPath = path.resolve(__dirname, '../../.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY');
    console.log('Available Env Vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')));
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTable() {
    console.log('Inspecting "payments" table...');

    // Try to insert a dummy record to see structure or just list columns if possible via metadata (not directly available easily without admin)
    // simpler: select one record
    const { data, error } = await supabase.from('payments').select('*').limit(1);

    if (error) {
        console.error('Error selecting from payments:', error);
    } else {
        console.log('Successfully selected from payments. Record sample:', data && data[0]);
        if (!data || data.length === 0) {
            console.log('Table is empty. Cannot infer columns from data.');
            const { error: insertError } = await supabase.from('payments').insert([{ method: 'test', amount: 0, invoiceId: '00000000-0000-0000-0000-000000000000' }]);
            console.log('Insert error (informative):', insertError);
        } else {
            console.log('Columns found:', Object.keys(data[0]));
            if (!Object.keys(data[0]).includes('user_id')) {
                console.log('CONFIRMED: user_id column is MISSING.');
            }
        }
    }
}

inspectTable();
