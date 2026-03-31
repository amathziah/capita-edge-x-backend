import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ORG_ID = '9d8de4aa-f112-448c-ab0e-68af9e63ccd5';

async function verify() {
    console.log('🔍 Verifying data for Org: ' + ORG_ID);
    
    const { count: custCount } = await supabase.from('customers').select('*', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
    console.log('Customers: ' + custCount);

    const { count: prodCount } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
    console.log('Products: ' + prodCount);

    const { data: invoices } = await supabase.from('invoices').select('invoiceNumber, project_name, total').eq('organization_id', ORG_ID);
    console.log('Invoices: ' + invoices.length);
    invoices.forEach(inv => {
        console.log(`- ${inv.invoiceNumber}: ${inv.project_name} (Total: ${inv.total})`);
    });

    const { count: itemCount } = await supabase.from('invoice_items').select('*', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
    console.log('Invoice Items: ' + itemCount);

    const { count: payCount } = await supabase.from('payments').select('*', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
    console.log('Payments: ' + payCount);

    const { count: expCount } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('organization_id', ORG_ID);
    console.log('Expenses: ' + expCount);
}

verify();
