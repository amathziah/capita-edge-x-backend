import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function debug() {
    const orgId = 'ae0359e0-d301-4221-8a93-aa139d7a626c';
    console.log(`Debugging Org: ${orgId}`);

    // 1. Count All Customers
    const { count: total, error: countErr } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId);
    console.log(`Total Customers (count): ${total}`);

    // 2. Fetch Stress Customers
    const { data: stressCustomers, error: fetchErr } = await supabase
        .from('customers')
        .select('id, email, name')
        .eq('organization_id', orgId)
        .or('email.ilike.stress%,name.ilike.Stress Customer%');

    console.log(`Stress Customers Found (fetch): ${stressCustomers?.length}`);
    if (stressCustomers?.length > 0) {
        console.log('Sample Stress Customers:', stressCustomers.slice(0, 3));
    }

    // 3. Fetch Non-Stress Customers
    const { data: otherCustomers } = await supabase
        .from('customers')
        .select('id, email, name')
        .eq('organization_id', orgId)
        .not('email', 'ilike', 'stress%')
        .not('name', 'ilike', 'Stress Customer%')
        .limit(5);

    console.log('Sample Other Customers:', otherCustomers);
}

debug();
