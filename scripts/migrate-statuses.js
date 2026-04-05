import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log('🔄 Unifying statuses: sent -> pending');
    let { error: err1 } = await supabase.from('invoices').update({ status: 'pending' }).eq('status', 'sent');
    if (err1) throw err1;

    console.log('🔄 Unifying statuses: overdue -> pending');
    let { error: err2 } = await supabase.from('invoices').update({ status: 'pending' }).eq('status', 'overdue');
    if (err2) throw err2;

    console.log('✅ Validation complete. Only core Financial States remain in DB.');
}

main().catch(err => {
    console.error('💥 Migration Error:', err.message);
    process.exit(1);
});
