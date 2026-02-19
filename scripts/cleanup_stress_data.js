import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
    const orgId = 'ae0359e0-d301-4221-8a93-aa139d7a626c'; // Default to target org
    console.log(`🧹 Cleaning up ALL stress test data for Org: ${orgId}`);

    // -1. Clean Reminders
    console.log('Cleaning Reminders...');
    const { error: remErr } = await supabase
        .from('reminders')
        .delete()
        .eq('organization_id', orgId)
        .ilike('task', 'Stress Reminder%');

    if (remErr) console.error('Error deleting reminders:', remErr.message);

    // 0. Clean Compliance Tasks
    console.log('Cleaning Compliance Tasks...');
    const { error: compErr } = await supabase
        .from('compliance_tasks')
        .delete()
        .eq('organization_id', orgId)
        .ilike('description', 'Stress Compliance Task%');

    if (compErr) console.error('Error deleting compliance tasks:', compErr.message);

    // 1. Delete Expenses
    console.log('Cleaning Expenses...');
    const { error: expErr } = await supabase
        .from('expenses')
        .delete()
        .eq('organization_id', orgId)
        .ilike('description', 'Stress Expense%');

    if (expErr) console.error('Error deleting expenses:', expErr.message);

    // 2. Identify Customers to delete
    console.log('Finding Customers...');
    const { data: customers, error: fetchErr } = await supabase
        .from('customers')
        .select('id')
        .eq('organization_id', orgId)
        .or('email.ilike.stress%,name.ilike.Stress Customer%'); // Handle both patterns

    if (fetchErr) {
        console.error('Error fetching customers:', fetchErr);
        return;
    }

    if (!customers || customers.length === 0) {
        console.log('No stress test customers found.');
    } else {
        // 3. Process Customers in Batches
        const BATCH_SIZE = 50;
        const customerIds = customers.map(c => c.id);
        console.log(`Found ${customerIds.length} customers. Processing in batches of ${BATCH_SIZE}...`);

        for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
            const batchIds = customerIds.slice(i, i + BATCH_SIZE);
            console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

            // A. Find Invoices for this batch of customers
            const { data: invoices, error: invFetchErr } = await supabase
                .from('invoices')
                .select('id')
                .in('customer_id', batchIds);

            if (invFetchErr) {
                console.error('Error fetching invoices for batch:', invFetchErr.message);
                continue;
            }

            const invoiceIds = invoices?.map(i => i.id) || [];

            if (invoiceIds.length > 0) {
                // B. Delete related data for these invoices
                // Payments
                const { error: payErr } = await supabase
                    .from('payments')
                    .delete()
                    .in('invoiceId', invoiceIds);
                if (payErr) console.error('Error deleting payments:', payErr.message);

                // Invoice Items
                const { error: itemsDelErr } = await supabase
                    .from('invoice_items')
                    .delete()
                    .in('invoiceId', invoiceIds);
                if (itemsDelErr) console.error('Error deleting items:', itemsDelErr.message);

                // Invoices
                const { error: invDelErr } = await supabase
                    .from('invoices')
                    .delete()
                    .in('id', invoiceIds);
                if (invDelErr) console.error('Error deleting invoices:', invDelErr.message);
            }

            // C. Delete Customers in this batch
            const { error: custDelErr } = await supabase
                .from('customers')
                .delete()
                .in('id', batchIds);

            if (custDelErr) console.error('Error deleting customers batch:', custDelErr.message);
        }
    }

    // 5. Delete Products
    console.log('Cleaning Products...');
    const { error: prodErr } = await supabase
        .from('products')
        .delete()
        .eq('organization_id', orgId)
        .ilike('name', 'Stress Product%');

    if (prodErr) console.error('Error deleting products:', prodErr.message);

    console.log('✅ Cleanup complete.');
}

cleanup();
