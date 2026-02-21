import { supabase } from '../supabase.js';
import { v4 as uuidv4 } from 'uuid';

// Helper for chunking arrays
const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
};

export const getDbVolume = async (req, res) => {
    const orgId = req.user.organizationId;

    try {
        const [products, customers, invoices, ledger] = await Promise.all([
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
            supabase.from('customers').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
            supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
            supabase.from('ledger_entries').select('*', { count: 'exact', head: true }).eq('organization_id', orgId)
        ]);

        return res.json({
            products: products.count || 0,
            customers: customers.count || 0,
            invoices: invoices.count || 0,
            ledger: ledger.count || 0
        });
    } catch (err) {
        console.error('Failed to fetch DB volume:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const runStressTest = async (req, res) => {
    const orgId = req.user.organizationId;
    const {
        productsCount = 100,
        customersCount = 200,
        invoicesCount = 500
    } = req.body;

    console.log(`🚀 Starting Stress Test for Org: ${orgId}`);

    // We'll return early to let the test run in the "background" (simulated) 
    // or we can stream progress if we were using WebSockets. 
    // For now, we'll respond after completion but keep batches small to avoid timeouts.

    try {
        // 1. PRODUCTS
        const products = [];
        const categories = ['Electronics', 'Accessories', 'Services', 'Raw Materials', 'Finished Goods'];
        for (let i = 0; i < productsCount; i++) {
            products.push({
                id: uuidv4(),
                organization_id: orgId,
                name: `Stress Prod ${i + 1}-${Math.random().toString(36).slice(2, 5)}`,
                description: 'Bulk seeded stress test product',
                category: categories[i % categories.length],
                price: Math.floor(Math.random() * 5000) + 100,
                costPrice: Math.floor(Math.random() * 3000) + 50,
                stock: Math.floor(Math.random() * 1000),
                minStock: 10,
                unit: 'pcs',
                status: 'Active'
            });
        }

        for (const chunk of chunkArray(products, 200)) {
            await supabase.from('products').insert(chunk);
        }

        // 2. CUSTOMERS
        const customers = [];
        for (let i = 0; i < customersCount; i++) {
            customers.push({
                id: uuidv4(),
                organization_id: orgId,
                name: `Stress Client ${i + 1}`,
                email: `stress.${i + 1}@example.com`,
                phone: `+91999${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`,
                address: 'Automated Stress Test Address'
            });
        }

        let insertedCustomers = [];
        for (const chunk of chunkArray(customers, 200)) {
            const { data } = await supabase.from('customers').insert(chunk).select('id, name, email');
            if (data) insertedCustomers = [...insertedCustomers, ...data];
        }

        // 3. INVOICES
        const invoices = [];
        const invoiceItems = [];
        const statuses = ['paid', 'sent', 'overdue', 'draft'];

        for (let i = 0; i < invoicesCount; i++) {
            const invId = uuidv4();
            const customer = insertedCustomers[i % insertedCustomers.length];
            const date = new Date(Date.now() - Math.floor(Math.random() * 60 * 24 * 60 * 60 * 1000));
            const total = Math.floor(Math.random() * 10000) + 500;

            invoices.push({
                id: invId,
                organization_id: orgId,
                customer_id: customer?.id,
                invoiceNumber: `STR-${Date.now().toString().slice(-4)}-${i + 1}`,
                status: statuses[i % statuses.length],
                total: total,
                subtotal: total * 0.85,
                taxAmount: total * 0.15,
                date: date.toISOString(),
                dueDate: new Date(date.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                buyer: { name: customer?.name || 'Unknown', email: customer?.email || 'N/A' }
            });

            invoiceItems.push({
                invoiceId: invId,
                organization_id: orgId,
                description: 'Stress Load Item',
                quantity: 1,
                price: total * 0.85,
                unit: 'pcs'
            });
        }

        for (const chunk of chunkArray(invoices, 200)) {
            await supabase.from('invoices').insert(chunk);
        }
        for (const chunk of chunkArray(invoiceItems, 200)) {
            await supabase.from('invoice_items').insert(chunk);
        }

        return res.json({
            message: 'Stress test completed successfully',
            summary: {
                productsGenerated: productsCount,
                customersGenerated: insertedCustomers.length,
                invoicesGenerated: invoicesCount
            }
        });
    } catch (err) {
        console.error('Stress test execution failed:', err);
        return res.status(500).json({ error: 'Stress test failed partially' });
    }
};
