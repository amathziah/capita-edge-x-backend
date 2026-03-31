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
const PASS_PERSONA = 'solopreneur';

async function seedInvoices() {
    console.log('🚀 Seeding 50 detailed invoices for akoshipa@gmail.com...');

    // 0. Cleanup
    console.log('🧹 Cleaning up old data for ' + ORG_ID + '...');
    await supabase.from('expenses').delete().eq('organization_id', ORG_ID);
    await supabase.from('payments').delete().eq('organization_id', ORG_ID);
    await supabase.from('invoice_items').delete().eq('organization_id', ORG_ID);
    await supabase.from('invoices').delete().eq('organization_id', ORG_ID);
    await supabase.from('products').delete().eq('organization_id', ORG_ID);
    await supabase.from('customers').delete().eq('organization_id', ORG_ID);

    // 1. Create a set of Customers (50)
    console.log('👥 Creating 50 high-detail customers...');
    const companies = [
        'Meta', 'Alphabet', 'Tesla', 'Peak', 'Stripe', 'Zoom', 'Shopify', 'HubSpot', 'Salesforce', 'Adobe',
        'Netflix', 'Amazon', 'Microsoft', 'Apple', 'Oracle', 'IBM', 'Intel', 'Cisco', 'Dell', 'HP',
        'Sony', 'Samsung', 'LG', 'Panasonic', 'Philips', 'Siemens', 'Bosch', 'Hitachi', 'Toshiba', 'Fujitsu',
        'Tencent', 'Alibaba', 'Baidu', 'TikTok', 'Snap', 'Spotify', 'Twitter', 'LinkedIn', 'Pinterest', 'Reddit',
        'Uber', 'Lyft', 'Airbnb', 'DoorDash', 'Instacart', 'Robinhood', 'Coinbase', 'Plaid', 'Stripe', 'Square'
    ];
    const suffixes = ['Inc', 'Corp', 'LLC', 'Global', 'India', 'Solutions', 'Technologies', 'Systems', 'Group', 'Partners'];
    const cities = ['Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Chennai', 'Gurgaon', 'Noida'];
    const states = ['Karnataka', 'Maharashtra', 'Delhi', 'Telangana', 'Maharashtra', 'Tamil Nadu', 'Haryana', 'Uttar Pradesh'];
    
    const customers = Array.from({ length: 50 }, (_, i) => {
        const baseName = companies[i % companies.length];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        const name = `${baseName} ${suffix}`;
        const cityIdx = Math.floor(Math.random() * cities.length);
        const tagsList = ['Enterprise', 'SMB', 'Startup', 'VIP', 'Partner', 'Reseller'];
        const numTags = 1 + Math.floor(Math.random() * 2);
        const tags = Array.from({ length: numTags }, () => tagsList[Math.floor(Math.random() * tagsList.length)]);

        const joinDate = new Date();
        joinDate.setDate(joinDate.getDate() - Math.floor(Math.random() * 90)); // Spread over last 90 days
        
        return {
            name,
            email: `billing@${baseName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
            phone: `+91 ${9000000000 + Math.floor(Math.random() * 999999999)}`,
            address: `${100 + Math.floor(Math.random() * 899)}, Tech Park, Phase ${1 + Math.floor(Math.random() * 5)}`,
            city: cities[cityIdx],
            state: states[cityIdx],
            pincode: `5000${10 + Math.floor(Math.random() * 89)}`,
            country: 'India',
            taxId: `27${Math.random().toString(36).substring(2, 12).toUpperCase().padEnd(10, 'A')}1Z5`, // Unified tax id since "gstin" mapping
            gstin: `27${Math.random().toString(36).substring(2, 12).toUpperCase().padEnd(10, 'A')}1Z5`, 
            organization_id: ORG_ID,
            createdAt: joinDate.toISOString()
        };
    });

    const { data: dbCustomers, error: custErr } = await supabase.from('customers').insert(customers).select();
    if (custErr) console.error('Error seeding customers:', custErr);

    // 2. Create a set of Products (20)
    const productNames = [
        'Cloud Audit', 'FS Development', 'UI/UX Design', 'AI Integration',
        'Security Review', 'API Design', 'DevOps Setup', 'QA Testing',
        'Technical Writing', 'SEO Audit', 'Performance Tuning', 'Mobile Development',
        'Database Optimization', 'Email Template Creation', 'Customer Research',
        'Brand Identity Kit', 'Marketing Strategy', 'Analytics Implementation',
        'Legacy Migration', 'AWS Consulting'
    ];
    const products = productNames.map((name, i) => ({
        name,
        price: 5000 + (Math.floor(Math.random() * 50) * 1000), // 5k to 55k
        category: 'Professional Services',
        item_type: 'service',
        organization_id: ORG_ID,
        tax_rate: 18
    }));

    console.log('📦 Creating 20 products...');
    const { data: dbProducts } = await supabase.from('products').insert(products).select();

    // 3. Generate 50 Invoices
    const statuses = ['paid', 'sent', 'overdue', 'draft'];
    const projectPrefixes = ['Enterprise', 'Alpha', 'Beta', 'Mainline', 'Project', 'Cloud', 'System', 'Backend', 'Frontend', 'Mobile'];
    
    console.log('📄 Generating 50 invoices...');
    for (let i = 1; i <= 50; i++) {
        const customer = dbCustomers[Math.floor(Math.random() * dbCustomers.length)];
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const date = new Date('2026-03-01');
        date.setDate(date.getDate() + (i % 30)); // Spread through March 2026
        
        const invoiceNumber = `INV-2026-${i.toString().padStart(3, '0')}`;
        const projectName = `${projectPrefixes[Math.floor(Math.random() * projectPrefixes.length)]} ${customer.name.split(' ')[0]} Integration`;
        
        // Generate 10-15 items for this invoice
        const itemCount = 10 + Math.floor(Math.random() * 6);
        const invoiceItemsRaw = [];
        let subtotal = 0;

        for (let j = 0; j < itemCount; j++) {
            const product = dbProducts[Math.floor(Math.random() * dbProducts.length)];
            const qty = 1 + Math.floor(Math.random() * 5);
            const lineTotal = product.price * qty;
            subtotal += lineTotal;

            invoiceItemsRaw.push({
                productId: product.id,
                description: `${product.name} - Milestone Phase ${j + 1}`,
                quantity: qty,
                price: product.price,
                sku: `SKU-SRV-${i}-${j}`,
                service_start_date: date.toISOString().split('T')[0],
                service_end_date: new Date(date).toISOString().split('T')[0],
                tax_rate: 18,
                taxable_value: lineTotal,
                cgst_amount: lineTotal * 0.09,
                sgst_amount: lineTotal * 0.09,
                organization_id: ORG_ID
            });
        }

        const taxAmount = subtotal * 0.18;
        const total = subtotal + taxAmount;

        const { data: invoice, error: invError } = await supabase.from('invoices').insert([{
            organization_id: ORG_ID,
            customer_id: customer.id,
            invoiceNumber,
            date: date.toISOString(),
            dueDate: new Date(date.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            status,
            project_name: projectName,
            shipping_address: 'Corporate Headquarters, ' + customer.state + ', India',
            order_number: `PO-${i}-${Math.floor(Math.random() * 9999)}`,
            tds_section: '194J',
            round_off: (Math.random() - 0.5),
            subtotal,
            taxAmount,
            total,
            taxType: 'GST',
            taxRate: 18,
            persona: PASS_PERSONA,
            buyer: { name: customer.name, email: customer.email, state: customer.state }
        }]).select().single();

        if (invError) {
            console.error(`Error creating invoice ${invoiceNumber}:`, invError);
            continue;
        }

        // Link items
        const invoiceItems = invoiceItemsRaw.map(item => ({ ...item, invoiceId: invoice.id }));
        const { error: itemsError } = await supabase.from('invoice_items').insert(invoiceItems);
        if (itemsError) console.error(`Error linking items for ${invoiceNumber}:`, itemsError);
        
        if (i % 10 === 0) console.log(`... ${i}/50 invoices completed.`);
    }

    // 4. Generate 50 Payments
    console.log('💰 Generating 50 payments...');
    const { data: dbInvoicesFinal } = await supabase.from('invoices').select('id, total, date, status').eq('organization_id', ORG_ID);
    const methods = ['bank_transfer', 'upi', 'cash', 'card'];

    const payments = [];
    for (let i = 0; i < 50; i++) {
        const inv = dbInvoicesFinal[i % dbInvoicesFinal.length];
        const date = new Date(inv.date);
        date.setDate(date.getDate() + 1); // Paid 1 day after invoice date

        payments.push({
            invoiceId: inv.id,
            amount: inv.total,
            date: date.toISOString(),
            method: methods[Math.floor(Math.random() * methods.length)],
            status: 'completed',
            notes: `Payment for ${i + 1} milestone`,
            organization_id: ORG_ID
        });
    }

    const { error: payError } = await supabase.from('payments').insert(payments);
    if (payError) console.error('Error seeding payments:', payError);

    // 5. Generate 50 Expenses
    console.log('💸 Generating 50 expenses...');
    const expenseCategories = ["Travel", "Meals", "Supplies", "Utilities", "Marketing", "Rent", "Salary", "Other", "Server Hosting", "Software Subscriptions"];
    const expenseDescriptions = [
        "Client Lunch", "Office Supplies", "Electricity Bill", "Facebook Ads", "Office Rent",
        "Employee Salary", "AWS Hosting", "Google Workspace", "Flight to Mumbai", "Hotel Stay",
        "Internet Bill", "Marketing Campaign", "Software Licenses", "Stationery", "Consulting Fee"
    ];

    const expenses = [];
    for (let i = 0; i < 50; i++) {
        const date = new Date('2026-03-01');
        date.setDate(date.getDate() + (i % 30));
        
        expenses.push({
            description: expenseDescriptions[Math.floor(Math.random() * expenseDescriptions.length)],
            amount: 1000 + Math.floor(Math.random() * 50000), // Random amount between 1k and 51k
            category: expenseCategories[Math.floor(Math.random() * expenseCategories.length)],
            date: date.toISOString(),
            organization_id: ORG_ID
        });
    }

    const { error: expError } = await supabase.from('expenses').insert(expenses);
    if (expError) console.error('Error seeding expenses:', expError);

    console.log('✅ 50 Detailed Invoices, 50 Payments, and 50 Expenses generated successfully for akoshipa@gmail.com!');
}

seedInvoices();
