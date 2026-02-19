
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials (SUPABASE_SERVICE_ROLE_KEY required)');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log('--- Verifying Schema Migration ---\n');
    let allGood = true;

    // 1. Check Organizations Table
    const { error: orgError } = await supabase.from('organizations').select('count', { count: 'exact', head: true });
    if (orgError) {
        console.error('❌ Table "organizations" NOT found or inaccessible:', orgError.message);
        allGood = false;
    } else {
        console.log('✅ Table "organizations" exists.');
    }

    // 2. Check Products Columns (Inventory Forecasting)
    // We can't easily check columns via JS client without inserting or selecting specific columns.
    // Let's try to select 'sales_velocity_30d' from products.
    const { error: prodError } = await supabase.from('products').select('sales_velocity_30d').limit(1);

    if (prodError) {
        // If error is "Column not found", we know.
        console.error('❌ Column "sales_velocity_30d" MISSING in "products":', prodError.message);
        allGood = false;
    } else {
        console.log('✅ Column "sales_velocity_30d" exists in "products".');
    }

    // 3. Check Last Sold At
    const { error: lastSoldError } = await supabase.from('products').select('last_sold_at').limit(1);
    if (lastSoldError) {
        console.error('❌ Column "last_sold_at" MISSING in "products".');
        allGood = false;
    } else {
        console.log('✅ Column "last_sold_at" exists in "products".');
    }

    console.log('\n---------------------------------');
    if (allGood) {
        console.log('🎉 MIGRATION VERIFIED SUCCESSFULLY!');
        console.log('   The Agents now have the database structure they need.');
    } else {
        console.log('⚠️ MIGRATION VERIFICATION FAILED.');
        console.log('   Please run the SQL script provided earlier in the Supabase Dashboard.');
    }
}

verify();
