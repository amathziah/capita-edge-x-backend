import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const EMAIL = 'jamathziah@gmail.com';

const randomDate = (m, e = 0) => {
    const d = new Date(); d.setMonth(d.getMonth() - m);
    return new Date(d.getTime() + Math.random() * (Date.now() - d.getTime() - 86400000 * 30 * e));
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rAmt = (min, max) => Math.round((min + Math.random() * (max - min)) * 100) / 100;

function genProducts(orgId) {
    return [
        { name: 'Enterprise Cloud Architecture', description: 'System design and multi-region deployment', price: 150000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Consulting' },
        { name: 'Annual Security Audit', description: 'Pen testing and compliance verification', price: 85000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Security' },
        { name: 'Managed Kubernetes Hosting', description: 'Monthly cluster management', price: 35000, unit: 'month', hsn_code: '998315', tax_rate: 18, category: 'Infrastructure' },
        { name: 'Generative AI Integration', description: 'LLM fine-tuning and pipeline setup', price: 220000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Development' },
        { name: 'Brand Strategy Masterclass', description: 'Workshop for executive teams', price: 65000, unit: 'session', hsn_code: '998397', tax_rate: 18, category: 'Consulting' },
        { name: 'B2B Marketing Campaign', description: 'LinkedIn outbound pipeline generation', price: 45000, unit: 'month', hsn_code: '998366', tax_rate: 18, category: 'Marketing' },
        { name: 'SaaS UX Audit', description: 'Deep conversion and usability review', price: 28000, unit: 'unit', hsn_code: '998397', tax_rate: 18, category: 'Design' },
        { name: 'Dedicated Retainer (Senior Dev)', description: '40 hours per week block allocation', price: 180000, unit: 'month', hsn_code: '998314', tax_rate: 18, category: 'Development' },
    ].map(p => ({
        ...p,
        organization_id: orgId,
        status: 'active',
        sku: `SKU-${p.name.replace(/[^A-Z]/gi, '').slice(0, 4).toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        stock: Math.floor(Math.random() * 50 + 10),
        reorder_level: 5,
    }));
}

function genDiverseInvoices(orgId, customers, products) {
    const invoices = [];
    const itemSets = [];
    // Weighted financial states using ONLY standard statuses
    // 'paid', 'pending', 'draft', 'cancelled'
    const statusPool = [
        'paid', 'paid', 'paid', 'paid', 'paid', 
        'pending', 'pending', 'pending', 'pending', 
        'draft', 'draft', 
        'cancelled'
    ];

    for (let i = 1; i <= 65; i++) {
        const customer = pick(customers);
        let status = pick(statusPool);
        const numItems = Math.floor(Math.random() * 4) + 1;
        const items = [];
        let subtotal = 0;

        const shuffledProducts = [...products].sort(() => 0.5 - Math.random());
        
        for (let j = 0; j < numItems; j++) {
            const product = shuffledProducts[j];
            const qty = Math.floor(Math.random() * 7) + 1;
            const discountPercent = Math.random() > 0.8 ? pick([5, 10, 15]) : 0;
            
            const rawTotal = product.price * qty;
            const lineDiscount = rawTotal * (discountPercent/100);
            const taxableValue = rawTotal - lineDiscount;
            
            subtotal += taxableValue;

            const cgst = Math.round(taxableValue * 0.09 * 100) / 100;
            const sgst = Math.round(taxableValue * 0.09 * 100) / 100;

            items.push({
                description: `${product.name} ${j===0 && i%3===0 ? ' - Priority SLA' : ''}`, 
                quantity: qty,
                price: product.price,
                unit: product.unit || 'Qty',
                hsn_code: product.hsn_code,
                tax_rate: 18,
                taxable_value: taxableValue,
                cgst_rate: 9, 
                sgst_rate: 9, 
                igst_rate: 0,
                cgst_amount: cgst,
                sgst_amount: sgst,
                igst_amount: 0,
                is_exempt: false,
                discount_percent: discountPercent,
                sort_order: j,
            });
        }

        const taxAmount = Math.round(subtotal * 0.18 * 100) / 100;
        const total = subtotal + taxAmount;
        
        let createdDate;
        let dueDate;
        
        // Simulating the dynamic states natively via the timeline!
        if (status === 'pending') {
            // 30% chance the pending invoice is mathematically overdue!
            const isOverdueTarget = Math.random() > 0.7;
            if (isOverdueTarget) {
                createdDate = randomDate(4, 1); // Created months ago
                dueDate = new Date(createdDate.getTime() + 86400000 * 15); // Due 15 days later (which is still rigidly in the past)
            } else {
                createdDate = randomDate(0.5); // Created recently
                dueDate = new Date(createdDate.getTime() + 86400000 * 30); // Due in future
            }
        } else if (status === 'paid') {
            createdDate = randomDate(9, 0); // Created between now and 9mo ago
            dueDate = new Date(createdDate.getTime() + 86400000 * pick([15, 30]));
        } else { // Draft / Cancelled
            createdDate = randomDate(1);
            dueDate = new Date(createdDate.getTime() + 86400000 * pick([15, 30]));
        }

        let amount_paid = 0;
        let viewTimestamp = null;

        if (status === 'paid') {
            amount_paid = total;
            viewTimestamp = new Date(createdDate.getTime() + 86400000 * 2).toISOString(); // Viewed 2 days after creation
        } else if (status === 'pending') {
            // Partial payment?
            if (Math.random() > 0.8) amount_paid = rAmt(total * 0.1, total * 0.4); 
            // Viewed? 60% of pending invoices have been viewed
            if (Math.random() > 0.4) viewTimestamp = new Date(createdDate.getTime() + 86400000).toISOString();
        }

        invoices.push({
            organization_id: orgId,
            customer_id: customer.id,
            invoiceNumber: `INV-${new Date(createdDate).getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
            buyer: { name: customer.name, address: customer.address, gstin: customer.gstin },
            subtotal: Math.round(subtotal * 100) / 100,
            taxAmount: taxAmount,
            taxRate: 18,
            taxType: 'GST',
            total: Math.round(total * 100) / 100,
            status,
            notes: pick(['Net 30 terms apply', 'Late fees applicable at 1.5% monthly', 'Thanks for trusting Capita!', 'Project Milestone', '']),
            dueDate: dueDate.toISOString(),
            date: createdDate.toISOString(),
            createdAt: createdDate.toISOString(),
            amount_paid: Math.round(amount_paid * 100) / 100,
            discount: 0,
            discount_amount: 0,
            shipping: 0,
            cgst_amount: Math.round(subtotal * 0.09 * 100) / 100,
            sgst_amount: Math.round(subtotal * 0.09 * 100) / 100,
            igst_amount: 0,
            gst_type: 'cgst_sgst',
            is_gst_registered: true,
            reverse_charge: false,
            tds_applicable: pick([true, false]),
            tds_rate: 10,
            tds_amount: Math.random() > 0.5 ? Math.round(subtotal * 0.1 * 100) / 100 : 0,
            net_receivable: total,
            round_off: 0,
            share_token: `st_view_${Math.random().toString(36).substring(2, 10)}${Date.now()}`,
            share_viewed_at: viewTimestamp,
            persona: 'solopreneur',
        });
        itemSets.push(items);
    }
    return { invoices, itemSets };
}

function genPayments(orgId, paidInvoices) {
    return paidInvoices.map((inv, i) => {
        const payDate = new Date(inv.date || inv.createdAt || new Date());
        payDate.setDate(payDate.getDate() + Math.floor(Math.random() * pick([5, 14, 29])));
        return {
            organization_id: orgId,
            customer_id: inv.customer_id,
            invoiceId: inv.id,
            amount: inv.status === 'paid' ? inv.total : (inv.amount_paid || 0),
            date: payDate.toISOString(),
            createdAt: payDate.toISOString(),
            method: pick(['upi', 'neft', 'rtgs', 'cheque', 'cash']),
            reference_number: `PAY-${Date.now().toString(36).toUpperCase()}-${i}`,
            notes: pick(['Cleared successfully', 'Wire transfer', 'NEFT batch', '']),
            status: 'completed',
            payment_mode: pick(['upi', 'neft', 'rtgs', 'cheque']),
        };
    });
}

async function main() {
    console.log('🔄 Fetching User Context...');
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === EMAIL);
    if (!user) throw new Error('User not found. Run seed-customers.js first.');
    
    const { data: orgs } = await supabase.from('organization_users').select('organization_id').eq('user_id', user.id);
    if (!orgs || !orgs.length) throw new Error('Organization not found.');
    const orgId = orgs[0].organization_id;

    console.log('🧹 Formatting Existing Financial Pipelines...');
    await supabase.from('payments').delete().eq('organization_id', orgId);
    await supabase.from('invoice_items').delete().eq('organization_id', orgId);
    await supabase.from('invoices').delete().eq('organization_id', orgId);
    await supabase.from('products').delete().eq('organization_id', orgId);

    console.log('👥 Fetching configured customers...');
    const { data: customers } = await supabase.from('customers').select('*').eq('organization_id', orgId);
    if (!customers || !customers.length) throw new Error('No customers found. (Re-run seed-customers.js)');

    console.log('📦 Refreshing Product Catalog...');
    const { data: products, error: pErr } = await supabase.from('products').insert(genProducts(orgId)).select();
    if (pErr) throw Error(pErr.message);

    console.log('🧾 Orchestrating 65 Pure Architecture Invoices...');
    const { invoices: invData, itemSets } = genDiverseInvoices(orgId, customers, products);
    
    // Chunk insert
    const { data: insertedInvoices, error: iErr } = await supabase.from('invoices').insert(invData).select();
    if (iErr) throw Error(iErr.message);
    
    console.log(`✅ Provisioned ${insertedInvoices.length} invoices`);
    
    const allItems = [];
    insertedInvoices.forEach((inv, idx) => {
        const items = itemSets[idx] || [];
        items.forEach(item => {
            allItems.push({ ...item, invoiceId: inv.id, organization_id: orgId });
        });
    });
    
    console.log('📋 Baking invoice items tables...');
    const { error: itemsErr } = await supabase.from('invoice_items').insert(allItems);
    if (itemsErr) throw Error(itemsErr.message);

    console.log('💰 Syncing Payment ledger...');
    const paidInvoices = insertedInvoices.filter(i => i.status === 'paid' || (i.amount_paid && i.amount_paid > 0));
    const { error: payErr } = await supabase.from('payments').insert(genPayments(orgId, paidInvoices));
    if (payErr) throw Error(payErr.message);

    // Calculate dynamic stats for logging
    const overdueCount = insertedInvoices.filter(i => i.status === 'pending' && new Date(i.dueDate) < new Date()).length;

    console.log(`\n🚀 Next-Gen Data Sync Completed for ${EMAIL}!`);
    console.log(`   - 8   Products Mapped`);
    console.log(`   - 65  Invoices (${paidInvoices.length} paid, ${insertedInvoices.filter(x=>x.status==='pending').length} pending/open)`);
    console.log(`   - 🚨  ${overdueCount} are mathematically overdue right now!`);
    console.log(`   - ${allItems.length} Line Items`);
}

main().catch(console.error);
