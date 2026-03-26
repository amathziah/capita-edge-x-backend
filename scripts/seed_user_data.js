import { supabase } from '../supabase.js';
import dotenv from 'dotenv';

dotenv.config();

const USERS = [
    { email: "w3@gmail.com", id: "5653cda5-91f4-4e31-9aaf-477adbc22f14", organizationId: "4204cf7a-5339-4bb7-be09-5a52ba58a32f", businessType: "ecommerce" },
    { email: "ca@capita.test", id: "3859fa1b-f216-482c-965e-dfe8c8497a8b", organizationId: "f1e79f52-228e-4cde-80c5-281c33008461", businessType: "ca_firm" },
    { email: "ecom@capita.test", id: "a3ec959c-d224-4f81-a350-ac8184ce494f", organizationId: "3e555f99-f7a5-4181-af48-2ff635745101", businessType: "ecommerce" },
    { email: "saas@capita.test", id: "6b83b870-371b-443a-bdd7-9545a61f5e28", organizationId: "5ed6cfe3-9359-48b4-9b5a-04e3e6b50578", businessType: "subscription" },
    { email: "agency@capita.test", id: "d77455de-0007-47a2-a187-5b930b3732ad", organizationId: "e0065d66-149b-4f79-bf5b-4242865a956a", businessType: "services_firm" },
    { email: "solo@capita.test", id: "2cdebb2c-fdff-4c63-92ee-f065a02d175a", organizationId: "05ca7aca-a0bc-48a1-9264-794995887e1e", businessType: "solopreneur" }
];

async function seedUser(user) {
    console.log(`\n🚀 Seeding account: ${user.email} (${user.businessType})`);

    try {
        // CLEANUP
        console.log(`🧹 Cleaning up old data for ${user.email}...`);
        await supabase.from('payments').delete().eq('organization_id', user.organizationId);
        await supabase.from('invoice_items').delete().eq('organization_id', user.organizationId);
        await supabase.from('invoices').delete().eq('organization_id', user.organizationId);
        await supabase.from('expenses').delete().eq('organization_id', user.organizationId);
        await supabase.from('products').delete().eq('organization_id', user.organizationId);
        await supabase.from('customers').delete().eq('organization_id', user.organizationId);

        // 1. DATA DEFINITIONS BASED ON PERSONA
        let customerSet = [
            { name: 'Acme Corp', state: 'Maharashtra', country: 'India' },
            { name: 'Global Tech', state: 'Karnataka', country: 'India' },
            { name: 'Peak Wellness', state: 'Delhi', country: 'India' }
        ];

        let productSet = [];
        let expenseSet = [];

        if (user.businessType === 'ecommerce') {
            productSet = [
                { name: 'Keyboard K1', price: 4500, category: 'Hardware', stock: 100, item_type: 'physical' },
                { name: 'Mouse M5', price: 2200, category: 'Hardware', stock: 200, item_type: 'physical' },
                { name: 'Monitor Q4', price: 25000, category: 'Hardware', stock: 20, item_type: 'physical' }
            ];
            expenseSet = [
                { description: 'Courier Charges', amount: 5000, category: 'Logistics' },
                { description: 'Warehouse Rent', amount: 35000, category: 'Operations' }
            ];
        } else if (user.businessType === 'subscription') {
            productSet = [
                { name: 'Standard Plan', price: 1500, category: 'SaaS', item_type: 'service' },
                { name: 'Pro Plan', price: 4500, category: 'SaaS', item_type: 'service' },
                { name: 'Enterprise Add-on', price: 10000, category: 'SaaS', item_type: 'service' }
            ];
            expenseSet = [
                { description: 'AWS Hosting', amount: 15000, category: 'Technology' },
                { description: 'Stripe Processing', amount: 8000, category: 'Financial' }
            ];
        } else if (user.businessType === 'services_firm') {
            productSet = [
                { name: 'Consulting Hour', price: 5000, category: 'Services', item_type: 'service' },
                { name: 'UX Design Audit', price: 45000, category: 'Services', item_type: 'service' },
                { name: 'Full Stack Build', price: 250000, category: 'Services', item_type: 'service' }
            ];
            expenseSet = [
                { description: 'Co-working Rent', amount: 12000, category: 'Rent' },
                { description: 'Software Licenses', amount: 5000, category: 'Tech' }
            ];
        } else if (user.businessType === 'ca_firm') {
            productSet = [
                { name: 'Tax Filing (Individual)', price: 3000, category: 'Tax', item_type: 'service' },
                { name: 'GST Compliance', price: 5000, category: 'Tax', item_type: 'service' },
                { name: 'Audit Service (Annual)', price: 50000, category: 'Audit', item_type: 'service' }
            ];
            expenseSet = [
                { description: 'Travel to Client', amount: 2000, category: 'Travel' },
                { description: 'Paper & Printing', amount: 1000, category: 'Ops' }
            ];
        } else { // solopreneur
            productSet = [
                { name: 'Freelance Design', price: 4000, category: 'Design', item_type: 'service' },
                { name: 'Logo creation', price: 15000, category: 'Design', item_type: 'service' }
            ];
            expenseSet = [
                { description: 'Figma Subscription', amount: 1200, category: 'Software' },
                { description: 'Internet Bill', amount: 1500, category: 'Utilities' }
            ];
        }

        // 2. SEED CUSTOMERS
        const customers = customerSet.map(c => ({ ...c, organization_id: user.organizationId }));
        const { data: dbCustomers } = await supabase.from('customers').insert(customers).select();

        // 3. SEED PRODUCTS
        const products = productSet.map(p => ({ ...p, organization_id: user.organizationId, cost_price: p.price * 0.5, tax_rate: 18 }));
        const { data: dbProducts } = await supabase.from('products').insert(products).select();

        // 4. SEED INVOICES
        const statuses = ['paid', 'overdue', 'sent', 'draft'];
        const invoicePayloads = [];
        for (let i = 0; i < 8; i++) {
            const customer = dbCustomers[i % dbCustomers.length];
            const product = dbProducts[i % dbProducts.length];
            const status = statuses[i % statuses.length];
            const date = new Date();
            date.setDate(date.getDate() - (i * 7));
            
            invoicePayloads.push({
                customer_id: customer.id,
                organization_id: user.organizationId,
                invoiceNumber: `INV-${(2000 + i).toString()}`,
                date: date.toISOString(),
                dueDate: new Date(date.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString(),
                status,
                subtotal: product.price,
                taxAmount: product.price * 0.18,
                total: product.price * 1.18,
                taxType: 'GST',
                taxRate: 18,
                buyer: { name: customer.name, email: customer.name.toLowerCase().replace(' ', '') + '@test.com', state: customer.state },
                persona: user.businessType,
                notes: `Test data for ${user.businessType} persona.`
            });
        }
        const { data: dbInvoices } = await supabase.from('invoices').insert(invoicePayloads).select();

        // 5. SEED INVOICE ITEMS
        const items = dbInvoices.map((inv, i) => {
            const prod = dbProducts[i % dbProducts.length];
            return {
                invoiceId: inv.id,
                productId: prod.id,
                description: prod.name,
                quantity: 1,
                price: prod.price,
                tax_rate: 18,
                taxable_value: prod.price,
                cgst_amount: prod.price * 0.09,
                sgst_amount: prod.price * 0.09,
                organization_id: user.organizationId
            };
        });
        await supabase.from('invoice_items').insert(items);

        // 6. SEED PAYMENTS
        const paidInvoices = dbInvoices.filter(inv => inv.status === 'paid');
        const payments = paidInvoices.map(inv => ({
            invoiceId: inv.id,
            amount: inv.total,
            date: inv.date,
            method: 'bank_transfer',
            status: 'completed',
            organization_id: user.organizationId
        }));
        await supabase.from('payments').insert(payments);

        // 7. SEED EXPENSES
        const finalExpenses = expenseSet.map(e => ({ ...e, organization_id: user.organizationId, user_id: user.id, date: new Date().toISOString() }));
        await supabase.from('expenses').insert(finalExpenses);

        console.log(`✅ ${user.email} Seeded Successfully!`);
    } catch (e) {
        console.error(`❌ Error seeding ${user.email}:`, e.message);
    }
}

async function startSeeding() {
    console.log('🌟 Starting Global Multi-Persona Seeding...');
    for (const user of USERS) {
        await seedUser(user);
    }
    console.log('\n✨ All accounts populated successfully!');
}

startSeeding();
