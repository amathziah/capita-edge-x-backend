
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Convert import.meta.url to __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initial config to load .env from server root (parent of scripts/)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL or Key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifySchema() {
    console.log('Verifying schema...');

    // 1. Try to select productId (camelCase) from invoice_items
    const { data, error } = await supabase
        .from('invoice_items')
        .select('productId')
        .limit(1);

    if (error) {
        if (error.message.includes('column "productId" does not exist') || error.code === '42703') {
            console.log('❌ FAIL: productId column also missing in invoice_items table.');
            console.log('Error details:', error.message);
            return false;
        } else {
            console.log('⚠️ UNEXPECTED ERROR:', error);
            console.log('Error details:', error.message);
            return false;
        }
    }

    console.log('✅ SUCCESS: productId column exists (camelCase).');
    return true;
}

verifySchema();
