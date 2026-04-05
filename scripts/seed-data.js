import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TARGET_EMAIL = 'jamathziah@gmail.com';

async function findUserAndOrg() {
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find(u => u.email === TARGET_EMAIL);
    if (!user) throw new Error(`User ${TARGET_EMAIL} not found`);
    
    const { data: orgs } = await supabase.from('organization_users')
        .select('organization_id, role')
        .eq('user_id', user.id);
    
    if (!orgs || orgs.length === 0) throw new Error('No organization found');
    
    const orgId = orgs[0].organization_id;
    console.log(`✅ User: ${user.id}`);
    console.log(`✅ Org:  ${orgId} (${orgs[0].role})`);
    return { userId: user.id, orgId };
}

// ── Helpers ──────────────────────────────────────────────────
function randomDate(monthsAgo, endMonthsAgo = 0) {
    const now = new Date();
    const s = new Date(now); s.setMonth(s.getMonth() - monthsAgo);
    const e = new Date(now); e.setMonth(e.getMonth() - endMonthsAgo);
    return new Date(s.getTime() + Math.random() * (e.getTime() - s.getTime()));
}
function rAmt(min, max) { return Math.round((min + Math.random() * (max - min)) * 100) / 100; }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

// ══════════════════════════════════════════════════════════════
// CUSTOMERS (15) — matches schema: name, email, phone, address, taxId, gstin, pan, state, city, pincode, country
// ══════════════════════════════════════════════════════════════
function genCustomers(orgId, userId) {
    const data = [
        { name: 'Priya Sharma', email: 'priya.sharma@techvista.in', phone: '+91-9876543210', address: '42 MG Road, Bangalore 560001', gstin: '29ABCDE1234F1Z5', state: 'Karnataka', city: 'Bangalore', pincode: '560001' },
        { name: 'Rajesh Kumar', email: 'rajesh@buildcraft.co.in', phone: '+91-9845612378', address: '15 Industrial Area Phase 2, Pune 411018', gstin: '27FGHIJ5678K2L3', state: 'Maharashtra', city: 'Pune', pincode: '411018' },
        { name: 'Ananya Patel', email: 'ananya@greenleaf.org', phone: '+91-9012345678', address: '8 Gandhi Nagar, Ahmedabad 380001', gstin: '24MNOPQ9012R3S4', state: 'Gujarat', city: 'Ahmedabad', pincode: '380001' },
        { name: 'Vikram Singh', email: 'vikram@nexgen.io', phone: '+91-8765432109', address: '101 Cyber City, Gurgaon 122002', gstin: '06TUVWX3456Y4Z5', state: 'Haryana', city: 'Gurgaon', pincode: '122002' },
        { name: 'Deepa Menon', email: 'deepa@coastalfoods.in', phone: '+91-9988776655', address: '23 Marine Drive, Kochi 682001', gstin: '32ABCDE7890F5G6', state: 'Kerala', city: 'Kochi', pincode: '682001' },
        { name: 'Arjun Reddy', email: 'arjun@skyline.dev', phone: '+91-9123456780', address: '67 Jubilee Hills, Hyderabad 500033', gstin: '36HIJKL1234M6N7', state: 'Telangana', city: 'Hyderabad', pincode: '500033' },
        { name: 'Meera Iyer', email: 'meera@artisan.studio', phone: '+91-7890123456', address: '5 Koramangala, Bangalore 560095', gstin: '29OPQRS5678T7U8', state: 'Karnataka', city: 'Bangalore', pincode: '560095' },
        { name: 'Suresh Nair', email: 'suresh@mediplus.health', phone: '+91-8567890123', address: '12 Anna Salai, Chennai 600002', gstin: '33VWXYZ9012A8B9', state: 'Tamil Nadu', city: 'Chennai', pincode: '600002' },
        { name: 'Kavitha Rao', email: 'kavitha@smartlearn.edu', phone: '+91-9456789012', address: '34 Banjara Hills, Hyderabad 500034', gstin: '36CDEFG3456H9I0', state: 'Telangana', city: 'Hyderabad', pincode: '500034' },
        { name: 'Amit Joshi', email: 'amit@cloudnine.tech', phone: '+91-9345678901', address: '78 Powai, Mumbai 400076', gstin: '27JKLMN7890O1P2', state: 'Maharashtra', city: 'Mumbai', pincode: '400076' },
        { name: 'Lakshmi Devi', email: 'lakshmi@silkroute.co', phone: '+91-8234567890', address: '56 T Nagar, Chennai 600017', gstin: '33QRSTU1234V2W3', state: 'Tamil Nadu', city: 'Chennai', pincode: '600017' },
        { name: 'Rohit Mehta', email: 'rohit@urbanplate.in', phone: '+91-7123456789', address: '90 Connaught Place, Delhi 110001', gstin: '07XYZAB5678C3D4', state: 'Delhi', city: 'New Delhi', pincode: '110001' },
        { name: 'Sneha Gupta', email: 'sneha@finwise.co.in', phone: '+91-9567890123', address: '21 Park Street, Kolkata 700016', gstin: '19EFGHI9012J4K5', state: 'West Bengal', city: 'Kolkata', pincode: '700016' },
        { name: 'Karthik Subramanian', email: 'karthik@automax.motors', phone: '+91-8901234567', address: '45 OMR Road, Chennai 600096', gstin: '33LMNOP3456Q5R6', state: 'Tamil Nadu', city: 'Chennai', pincode: '600096' },
        { name: 'Nisha Agarwal', email: 'nisha@bloombox.co', phone: '+91-7654321098', address: '18 Sector 17, Chandigarh 160017', gstin: '04STUVW7890X6Y7', state: 'Chandigarh', city: 'Chandigarh', pincode: '160017' },
    ];
    return data.map(c => ({ ...c, organization_id: orgId, user_id: userId, country: 'India' }));
}

// ══════════════════════════════════════════════════════════════
// PRODUCTS (12)
// ══════════════════════════════════════════════════════════════
function genProducts(orgId) {
    return [
        { name: 'Web Development Package', description: 'Full-stack web app development', price: 75000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Development' },
        { name: 'Mobile App Development', description: 'Cross-platform React Native app', price: 120000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Development' },
        { name: 'UI/UX Design', description: 'Wireframes, prototypes, design system', price: 35000, unit: 'project', hsn_code: '998397', tax_rate: 18, category: 'Design' },
        { name: 'SEO Audit & Strategy', description: '90-day SEO growth strategy', price: 15000, unit: 'unit', hsn_code: '998366', tax_rate: 18, category: 'Marketing' },
        { name: 'Monthly Hosting', description: 'Cloud hosting, SSL, backups', price: 5000, unit: 'month', hsn_code: '998315', tax_rate: 18, category: 'Infrastructure' },
        { name: 'Content Writing', description: 'SEO blog article 1500-2000 words', price: 3500, unit: 'unit', hsn_code: '998395', tax_rate: 18, category: 'Content' },
        { name: 'Brand Identity Package', description: 'Logo, brand guides, collateral', price: 45000, unit: 'project', hsn_code: '998397', tax_rate: 18, category: 'Design' },
        { name: 'API Integration', description: 'Third-party API integration', price: 25000, unit: 'unit', hsn_code: '998314', tax_rate: 18, category: 'Development' },
        { name: 'Social Media Management', description: 'Monthly 4 platforms, 20 posts', price: 18000, unit: 'month', hsn_code: '998366', tax_rate: 18, category: 'Marketing' },
        { name: 'Database Optimization', description: 'Query optimization & indexing', price: 20000, unit: 'unit', hsn_code: '998314', tax_rate: 18, category: 'Development' },
        { name: 'Consultation (per hour)', description: 'Architecture review, code audit', price: 3000, unit: 'hour', hsn_code: '998318', tax_rate: 18, category: 'Consulting' },
        { name: 'E-commerce Setup', description: 'Full store with payments & inventory', price: 85000, unit: 'project', hsn_code: '998314', tax_rate: 18, category: 'Development' },
    ].map(p => ({
        ...p,
        organization_id: orgId,
        status: 'active',
        sku: `SKU-${p.name.replace(/[^A-Z]/gi, '').slice(0, 4).toUpperCase()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        stock: Math.floor(Math.random() * 50 + 10),
        reorder_level: 5,
    }));
}

// ══════════════════════════════════════════════════════════════
// INVOICES (55) — with invoice_items as separate table
// ══════════════════════════════════════════════════════════════
function genInvoices(orgId, customerIds, products) {
    const invoices = [];
    const itemSets = [];
    const statuses = ['paid', 'paid', 'paid', 'pending', 'pending', 'overdue', 'sent'];

    for (let i = 1; i <= 55; i++) {
        const customerId = pick(customerIds);
        const numItems = Math.floor(Math.random() * 3) + 1;
        const items = [];
        let subtotal = 0;

        for (let j = 0; j < numItems; j++) {
            const product = pick(products);
            const qty = Math.floor(Math.random() * 5) + 1;
            const lineTotal = product.price * qty;
            subtotal += lineTotal;
            items.push({
                description: product.name,
                quantity: qty,
                price: product.price,
                unit: product.unit || 'Qty',
                hsn_code: product.hsn_code,
                tax_rate: 18,
                taxable_value: lineTotal,
                cgst_rate: 9, sgst_rate: 9, igst_rate: 0,
                cgst_amount: Math.round(lineTotal * 0.09 * 100) / 100,
                sgst_amount: Math.round(lineTotal * 0.09 * 100) / 100,
                igst_amount: 0,
                is_exempt: false,
                discount_percent: 0,
                sort_order: j,
            });
        }

        const taxAmount = Math.round(subtotal * 0.18 * 100) / 100;
        const total = subtotal + taxAmount;
        const status = pick(statuses);
        const createdDate = randomDate(10, 0);
        const dueDate = new Date(createdDate);
        dueDate.setDate(dueDate.getDate() + pick([15, 30, 45, 60]));

        const buyer = { name: `Customer ${i}` }; // Will get real names from customer lookup

        invoices.push({
            organization_id: orgId,
            customer_id: customerId,
            invoiceNumber: `INV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`,
            buyer: { name: `Customer` },
            subtotal,
            taxAmount,
            taxRate: 18,
            taxType: 'GST',
            total,
            status,
            notes: pick(['Payment due within 30 days', 'Thank you for your business!', 'Please include invoice number in reference', '']),
            dueDate: dueDate.toISOString(),
            date: createdDate.toISOString(),
            amount_paid: status === 'paid' ? total : (status === 'pending' ? rAmt(0, total * 0.5) : 0),
            discount: 0,
            discount_amount: 0,
            shipping: 0,
            cgst_amount: Math.round(subtotal * 0.09 * 100) / 100,
            sgst_amount: Math.round(subtotal * 0.09 * 100) / 100,
            igst_amount: 0,
            gst_type: 'cgst_sgst',
            is_gst_registered: true,
            reverse_charge: false,
            tds_applicable: false,
            tds_rate: 0,
            tds_amount: 0,
            net_receivable: total,
            round_off: 0,
            follow_up_count: 0,
            persona: 'solopreneur',
        });
        itemSets.push(items);
    }
    return { invoices, itemSets };
}

// ══════════════════════════════════════════════════════════════
// EXPENSES (55)
// ══════════════════════════════════════════════════════════════
function genExpenses(orgId, userId) {
    const categories = ['Software & Tools', 'Cloud Hosting', 'Office Supplies', 'Professional Development', 'Marketing & Ads', 'Travel', 'Internet & Phone', 'Freelancer Payments', 'Insurance', 'Legal & Accounting', 'Equipment', 'Miscellaneous'];
    const vendors = ['AWS', 'Google Cloud', 'Figma', 'Notion', 'Slack', 'Adobe', 'Vercel', 'GitHub', 'Zoom', 'HubSpot', 'Jio Fiber', 'Airtel', 'WeWork', 'Razorpay', 'Upwork', 'LinkedIn Ads', 'Google Ads', 'Swiggy', 'Uber', 'Amazon', 'Flipkart', 'LegalSeva', 'CA Services', 'Hostinger', 'Cloudflare'];
    const expenses = [];

    for (let i = 0; i < 55; i++) {
        const category = pick(categories);
        const vendor = pick(vendors);
        const date = randomDate(10, 0);
        let amount;
        switch (category) {
            case 'Cloud Hosting': amount = rAmt(2000, 15000); break;
            case 'Software & Tools': amount = rAmt(500, 8000); break;
            case 'Freelancer Payments': amount = rAmt(10000, 50000); break;
            case 'Marketing & Ads': amount = rAmt(5000, 30000); break;
            case 'Travel': amount = rAmt(1000, 15000); break;
            case 'Equipment': amount = rAmt(5000, 50000); break;
            default: amount = rAmt(500, 10000);
        }
        const gstAmt = Math.round(amount * 0.18 * 100) / 100;

        expenses.push({
            organization_id: orgId,
            user_id: userId,
            description: `${vendor} - ${category}`,
            amount: amount + gstAmt,
            category,
            vendor_name: vendor,
            date: date.toISOString(),
            gst_amount: gstAmt,
            is_itc_eligible: pick([true, true, false]),
            payment_mode: pick(['UPI', 'Credit Card', 'Bank Transfer', 'Debit Card']),
            reference_number: `RCP-${Date.now().toString(36).toUpperCase()}-${i}`,
        });
    }
    return expenses;
}

// ══════════════════════════════════════════════════════════════
// PAYMENTS (linked to paid invoices)
// ══════════════════════════════════════════════════════════════
function genPayments(orgId, paidInvoices) {
    return paidInvoices.map((inv, i) => {
        const payDate = new Date(inv.date || inv.createdAt || new Date());
        payDate.setDate(payDate.getDate() + Math.floor(Math.random() * 25) + 1);
        return {
            organization_id: orgId,
            customer_id: inv.customer_id,
            invoiceId: inv.id,
            amount: inv.status === 'paid' ? inv.total : (inv.amount_paid || 0),
            date: payDate.toISOString(),
            method: pick(['upi', 'neft', 'rtgs', 'cheque', 'cash']),
            reference_number: `PAY-${Date.now().toString(36).toUpperCase()}-${i}`,
            notes: pick(['Full payment received', 'Partial payment', 'Auto-debit', '']),
            status: 'completed',
            payment_mode: pick(['upi', 'neft', 'rtgs', 'cheque', 'cash']),
        };
    });
}

// ══════════════════════════════════════════════════════════════
// COMPLIANCE (16)
// ══════════════════════════════════════════════════════════════
function genCompliance(orgId) {
    return [
        { type: 'GST', description: 'File GSTR-1 outward supplies for March 2026', priority: 'high', due_date: '2026-04-11', status: 'pending' },
        { type: 'GST', description: 'File GSTR-3B summary return for March 2026', priority: 'high', due_date: '2026-04-20', status: 'pending' },
        { type: 'TDS', description: 'Deposit TDS collected in Jan-Mar quarter', priority: 'high', due_date: '2026-04-30', status: 'pending' },
        { type: 'Income Tax', description: 'Pay first installment advance tax FY27', priority: 'medium', due_date: '2026-06-15', status: 'pending' },
        { type: 'GST', description: 'File GSTR-1 for January 2026', priority: 'high', due_date: '2026-02-11', status: 'completed' },
        { type: 'GST', description: 'File GSTR-3B for January 2026', priority: 'high', due_date: '2026-02-20', status: 'completed' },
        { type: 'GST', description: 'File GSTR-1 for February 2026', priority: 'high', due_date: '2026-03-11', status: 'completed' },
        { type: 'GST', description: 'File GSTR-3B for February 2026', priority: 'high', due_date: '2026-03-20', status: 'completed' },
        { type: 'GST', description: 'GSTR-9 annual return for FY2024-25', priority: 'high', due_date: '2025-12-31', status: 'completed' },
        { type: 'Professional Tax', description: 'Professional tax Jul-Dec period', priority: 'low', due_date: '2026-01-31', status: 'completed' },
        { type: 'TDS', description: 'Quarterly TDS return Oct-Dec', priority: 'medium', due_date: '2026-01-31', status: 'completed' },
        { type: 'Income Tax', description: 'Income Tax Return for FY2024-25', priority: 'high', due_date: '2025-07-31', status: 'completed' },
        { type: 'GST', description: 'ITC reconciliation GSTR-2A vs books', priority: 'medium', due_date: '2025-10-31', status: 'completed' },
        { type: 'Regulatory', description: 'Renew trade license for FY2026-27', priority: 'medium', due_date: '2026-03-31', status: 'completed' },
        { type: 'Audit', description: 'Prepare books for tax audit', priority: 'high', due_date: '2025-09-30', status: 'completed' },
        { type: 'Regulatory', description: 'Renew Udyam Registration certificate', priority: 'low', due_date: '2026-06-30', status: 'pending' },
    ].map(t => ({ ...t, organization_id: orgId }));
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
    console.log('🚀 Seeding data for', TARGET_EMAIL);
    console.log('─'.repeat(60));
    const { userId, orgId } = await findUserAndOrg();

    // ── Customers ──
    console.log('\n👥 Customers (15)...');
    const { data: customers, error: e1 } = await supabase.from('customers').insert(genCustomers(orgId, userId)).select('id, name');
    if (e1) { console.error('❌', e1.message); return; }
    const customerIds = customers.map(c => c.id);
    console.log(`  ✅ ${customers.length} created`);

    // ── Products ──
    console.log('📦 Products (12)...');
    const { data: products, error: e2 } = await supabase.from('products').insert(genProducts(orgId)).select('id, name, price, unit, hsn_code');
    if (e2) { console.error('❌', e2.message); return; }
    console.log(`  ✅ ${products.length} created`);

    // ── Invoices + Items ──
    console.log('🧾 Invoices (55)...');
    const { invoices: invData, itemSets } = genInvoices(orgId, customerIds, products);
    const { data: invoices, error: e3 } = await supabase.from('invoices').insert(invData).select('id, status, total, amount_paid, customer_id, date, createdAt');
    if (e3) { console.error('❌', e3.message); return; }
    console.log(`  ✅ ${invoices.length} invoices`);

    // Insert invoice items
    const allItems = [];
    invoices.forEach((inv, idx) => {
        const items = itemSets[idx] || [];
        items.forEach(item => {
            allItems.push({ ...item, invoiceId: inv.id, organization_id: orgId });
        });
    });
    if (allItems.length > 0) {
        const { error: e3b } = await supabase.from('invoice_items').insert(allItems);
        if (e3b) console.error('  ⚠️ Items error:', e3b.message);
        else console.log(`  ✅ ${allItems.length} line items`);
    }

    const paid = invoices.filter(i => i.status === 'paid').length;
    const pending = invoices.filter(i => i.status === 'pending').length;
    const overdue = invoices.filter(i => i.status === 'overdue').length;
    console.log(`     Paid: ${paid} | Pending: ${pending} | Overdue: ${overdue} | Sent: ${invoices.length - paid - pending - overdue}`);

    // ── Expenses ──
    console.log('💸 Expenses (55)...');
    const { data: expenses, error: e4 } = await supabase.from('expenses').insert(genExpenses(orgId, userId)).select('id');
    if (e4) { console.error('❌', e4.message); return; }
    console.log(`  ✅ ${expenses.length} created`);

    // ── Payments ──
    console.log('💰 Payments...');
    const paidInvoices = invoices.filter(i => i.status === 'paid' || (i.amount_paid && i.amount_paid > 0));
    const { data: payments, error: e5 } = await supabase.from('payments').insert(genPayments(orgId, paidInvoices)).select('id');
    if (e5) { console.error('❌', e5.message); return; }
    console.log(`  ✅ ${payments.length} created`);

    // ── Compliance ──
    console.log('📑 Compliance (16)...');
    const { data: compliance, error: e6 } = await supabase.from('compliance_tasks').insert(genCompliance(orgId)).select('id');
    if (e6) { console.error('❌', e6.message); return; }
    console.log(`  ✅ ${compliance.length} created`);

    // ── Summary ──
    const total = customers.length + products.length + invoices.length + allItems.length + expenses.length + payments.length + compliance.length;
    console.log('\n' + '═'.repeat(60));
    console.log('✅ SEED COMPLETE');
    console.log('═'.repeat(60));
    console.log(`  👥 Customers:     ${customers.length}`);
    console.log(`  📦 Products:      ${products.length}`);
    console.log(`  🧾 Invoices:      ${invoices.length}`);
    console.log(`  📋 Line Items:    ${allItems.length}`);
    console.log(`  💸 Expenses:      ${expenses.length}`);
    console.log(`  💰 Payments:      ${payments.length}`);
    console.log(`  📑 Compliance:    ${compliance.length}`);
    console.log(`  ─────────────────────────────`);
    console.log(`  📊 TOTAL:         ${total} records`);
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });
