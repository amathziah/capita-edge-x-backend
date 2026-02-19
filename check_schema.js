
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
    console.log('Checking Invoices Schema...');

    // Try to select organization_id from invoices
    // If column doesn't exist, this should error
    const { data, error } = await supabase
        .from('invoices')
        .select('organization_id')
        .limit(1);

    if (error) {
        console.error('❌ Error selecting organization_id:', error.message);
        if (error.code === 'PGRST204' || error.message.includes('does not exist')) {
            console.log('⚠️  Confirmed: organization_id column is missing!');
        }
    } else {
        console.log('✅ organization_id column exists (or at least query worked). Data:', data);
    }
}

checkSchema();
