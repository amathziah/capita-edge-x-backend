import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedData(count = 100) {
    let ORG_ID = process.env.EXISTING_ORG_ID;

    if (ORG_ID) {
        console.log(`ℹ️  Using EXISTING Organization ID: ${ORG_ID}`);
    } else {
        ORG_ID = uuidv4();
        console.log(`🆕 Creating NEW Organization: ${ORG_ID}`);

        // 1. Create Organization
        const { error: orgErr } = await supabase
            .from('organizations')
            .insert([{
                id: ORG_ID,
                name: 'Stress Test Org',
                slug: `stress-test-${Date.now()}`
            }]);

        if (orgErr) {
            console.error('Failed to create organization:', orgErr.message);
            return;
        }
    }

    const customers = [];
    for (let i = 0; i < count; i++) {
        customers.push({
            id: uuidv4(),
            name: `Stress Customer ${i}`,
            email: `stress${i}@example.com`,
            organization_id: ORG_ID
        });
    }

    console.log('📦 Inserting customers...');
    const { data: insertedCustomers, error: custErr } = await supabase
        .from('customers')
        .insert(customers)
        .select();

    if (custErr) {
        console.error('Failed to seed customers:', custErr);
        return;
    }

    const invoices = [];
    const invoiceItems = [];

    for (const customer of insertedCustomers) {
        const invId = uuidv4();
        invoices.push({
            id: invId,
            invoiceNumber: `STR-${Math.random().toString(36).toUpperCase().slice(2, 8)}`,
            customer_id: customer.id,
            organization_id: ORG_ID,
            status: 'draft',
            total: 1000,
            subtotal: 1000,
            date: new Date().toISOString().split('T')[0],
            buyer: { name: customer.name, email: customer.email }
        });

        invoiceItems.push({
            invoiceId: invId,
            description: 'Stress Test Item',
            quantity: 1,
            price: 1000,
            organization_id: ORG_ID
        });
    }

    console.log('📦 Inserting invoices...');
    const { error: invErr } = await supabase.from('invoices').insert(invoices);
    if (invErr) {
        console.error('Failed to seed invoices:', invErr);
        return;
    }

    console.log('📦 Inserting invoice items...');
    const { error: itemsErr } = await supabase.from('invoice_items').insert(invoiceItems);
    if (itemsErr) {
        console.error('Failed to seed items:', itemsErr);
        return;
    }

    console.log('✅ Seeding complete!');
    console.log('--------------------------------------------------');
    console.log('Environment Variables for Stress Test:');
    console.log(`STRESS_ORG_ID=${ORG_ID}`);
    console.log('--------------------------------------------------');
}

seedData(200); // Start with 200 for a quick but effective test
