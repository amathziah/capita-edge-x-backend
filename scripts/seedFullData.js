import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

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

const ORG_ID = process.env.EXISTING_ORG_ID;
if (!ORG_ID) {
    console.error('EXISTING_ORG_ID environment variable is required.');
    process.exit(1);
}

// Helpers
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));

async function getUserId(orgId) {
    // 1. Try to find the specific test user first
    const { data: testUser } = await supabase.from('users').select('id').eq('email', 'test@example.com').single(); // Assuming 'users' table or auth.users not directly accessible via client? 
    // Actually, 'users' table in public schema usually mirrors auth.users. 
    // If not, we fall back to organization_users.

    // Better strategy: Search in organization_users for a user known to be 'test@example.com' 
    // BUT organization_users table has user_id, not email. 
    // We can't easily query auth.users from client without service key admin privileges (which we have).

    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    const targetUser = users?.find(u => u.email === 'test@example.com');
    if (targetUser) return targetUser.id;

    // Fallback: Try to find a user in this org to assign as 'user_id' for audit fields
    const { data } = await supabase
        .from('organization_users')
        .select('user_id')
        .eq('organization_id', orgId)
        .limit(1)
        .single();

    if (data) return data.user_id;
    return uuidv4();
}

async function seedFullData() {
    console.log(`🚀 Starting FULL Seeding for Org: ${ORG_ID}`);
    const userId = await getUserId(ORG_ID);
    console.log(`👤 Using User ID for audit: ${userId}`);

    const customersCount = 200;
    const productsCount = 50;
    const invoicesCount = 300;
    const expensesCount = 50;

    // 1. PRODUCTS
    console.log('📦 Seeding Products...');
    const products = [];
    for (let i = 0; i < productsCount; i++) {
        products.push({
            id: uuidv4(),
            name: `Stress Product ${i}`,
            description: `Description for stress product ${i}`,
            price: randomInt(100, 5000),
            stock: randomInt(0, 500),
            minStock: 10,
            unit: randomChoice(['pcs', 'kg', 'ltr', 'box']),
            organization_id: ORG_ID,
            category: randomChoice(['Electronics', 'Office', 'Raw Material', 'Services'])
        });
    }
    const { error: prodErr } = await supabase.from('products').insert(products);
    if (prodErr) console.error('Product seed error:', prodErr);

    // 2. CUSTOMERS
    console.log('👥 Seeding Customers...');
    const customers = [];
    for (let i = 0; i < customersCount; i++) {
        customers.push({
            id: uuidv4(),
            name: `Stress Customer ${i}`,
            email: `stress.full.${i}@example.com`,
            organization_id: ORG_ID,
            user_id: userId
        });
    }
    const { data: insertedCustomers, error: custErr } = await supabase
        .from('customers')
        .insert(customers)
        .select();

    if (custErr) {
        console.error('Customer seed error:', custErr);
        return;
    }

    // 3. INVOICES & ITEMS & PAYMENTS
    console.log('📄 Seeding Invoices, Items, and Payments...');
    const invoices = [];
    const invoiceItems = [];
    const payments = [];

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const endDate = new Date();

    for (let i = 0; i < invoicesCount; i++) {
        const customer = randomChoice(insertedCustomers);
        const invId = uuidv4();
        const date = randomDate(startDate, endDate);
        const dueDate = new Date(date);
        dueDate.setDate(dueDate.getDate() + 30);

        // Random items
        const numItems = randomInt(1, 5);
        let subtotal = 0;

        for (let j = 0; j < numItems; j++) {
            const prod = randomChoice(products);
            const qty = randomInt(1, 10);
            const price = prod.price;
            const itemTotal = qty * price;

            subtotal += itemTotal;
            invoiceItems.push({
                invoiceId: invId,
                productId: prod.id,
                description: prod.name,
                quantity: qty,
                price: price,
                unit: prod.unit,
                discount: 0,
                organization_id: ORG_ID
            });
        }

        const status = randomChoice(['draft', 'sent', 'paid', 'overdue']);
        const taxRate = 18;
        const taxAmount = subtotal * (taxRate / 100);
        const total = subtotal + taxAmount;

        invoices.push({
            id: invId,
            invoiceNumber: `STR-FULL-${i}-${Date.now().toString().slice(-4)}`,
            customer_id: customer.id,
            organization_id: ORG_ID,
            status: status,
            subtotal: subtotal,
            taxAmount: taxAmount,
            taxRate: taxRate,
            total: total,
            date: date.toISOString(),
            dueDate: dueDate.toISOString(),
            createdAt: date.toISOString(),
            buyer: { name: customer.name, email: customer.email }
        });

        // 4. PAYMENTS (for Paid invoices)
        if (status === 'paid') {
            payments.push({
                invoiceId: invId,
                amount: total,
                date: new Date(date.getTime() + 86400000).toISOString(), // Paid 1 day later
                method: randomChoice(['Credit Card', 'Bank Transfer', 'Cash', 'UPI']),
                status: 'completed',
                organization_id: ORG_ID,
                notes: 'Auto-generated payment'
            });
        }
    }

    // Insert batches to avoid payload limits
    const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

    // Invoices
    for (const batch of chunk(invoices, 100)) {
        const { error } = await supabase.from('invoices').insert(batch);
        if (error) console.error('Invoice batch error:', error);
    }

    // Invoice Items
    for (const batch of chunk(invoiceItems, 100)) {
        const { error } = await supabase.from('invoice_items').insert(batch);
        if (error) console.error('Invoice Items batch error:', error);
    }

    // Payments
    for (const batch of chunk(payments, 100)) {
        const { error } = await supabase.from('payments').insert(batch);
        if (error) console.error('Payments batch error:', error);
    }

    // 5. EXPENSES
    console.log('💸 Seeding Expenses...');
    const expenses = [];
    for (let i = 0; i < expensesCount; i++) {
        const date = randomDate(startDate, endDate);
        expenses.push({
            id: uuidv4(),
            description: `Stress Expense ${i}`,
            amount: randomInt(100, 2000),
            date: date.toISOString(),
            category: randomChoice(['Travel', 'Software', 'Office', 'Marketing']),
            organization_id: ORG_ID,
            user_id: userId
        });
    }
    const { error: expErr } = await supabase.from('expenses').insert(expenses);
    if (expErr) console.error('Expenses seed error:', expErr);

    // 6. COMPLIANCE TASKS
    console.log('📋 Seeding Compliance Tasks...');
    const complianceTasks = [];
    const complianceTypes = ['GST Return', 'TDS Payment', 'Advance Tax', 'PF Filing', 'ESI Filing', 'Annual Return'];

    for (let i = 0; i < 30; i++) {
        const dueDate = randomDate(startDate, new Date(endDate.getTime() + 86400000 * 60)); // +/- 60 days
        const status = randomChoice(['pending', 'completed', 'overdue']);

        complianceTasks.push({
            id: uuidv4(),
            organization_id: ORG_ID,
            type: randomChoice(complianceTypes),
            description: `Stress Compliance Task ${i}`,
            due_date: dueDate.toISOString(),
            status: status,
            priority: randomChoice(['low', 'medium', 'high', 'critical']),
            notes: 'Auto-generated compliance task'
        });
    }

    const { error: compErr } = await supabase.from('compliance_tasks').insert(complianceTasks);
    if (compErr) console.error('Compliance seed error:', compErr);

    // 7. REMINDERS
    console.log('⏰ Seeding Reminders...');
    const reminders = [];
    const priorities = ['Low', 'Medium', 'High'];

    for (let i = 0; i < 30; i++) {
        const dueDate = randomDate(startDate, new Date(endDate.getTime() + 86400000 * 30)); // +/- 30 days
        const isCompleted = Math.random() > 0.7;

        reminders.push({
            id: uuidv4(),
            organization_id: ORG_ID,
            user_id: userId, // Reminders are per-user usually, or org-wide depending on RLS. Script has userId.
            task: `Stress Reminder ${i}: Follow up with ${randomChoice(['Client', 'Vendor', 'Team'])}`,
            due_date: dueDate.toISOString(),
            priority: randomChoice(priorities),
            completed: isCompleted,
            snoozed_until: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    const { error: remErr } = await supabase.from('reminders').insert(reminders);
    if (remErr) console.error('Reminders seed error:', remErr);

    console.log('✅ Full Seeding Complete!');
}

seedFullData();
