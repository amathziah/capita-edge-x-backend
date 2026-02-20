
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyStockLogic() {
    console.log('--- Verifying Inventory Aggregation & Validation ---');

    // 1. Login
    const { data: { session }, error: loginError } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123'
    });

    if (loginError) {
        console.error('Login failed:', loginError.message);
        return;
    }

    const token = session.access_token;

    // 2. Get a test product
    const prodRes = await fetch('http://localhost:3000/api/products', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const products = await prodRes.json();
    if (products.length === 0) {
        console.error('No products found to test with.');
        return;
    }

    const product = products[0];
    console.log(`Testing with product: ${product.name} (Current Stock: ${product.stock})`);

    // 3. Test: Insufficient Stock Validation
    console.log('\nTest 1: Attempting to sell more than available stock...');
    const invalidInvoice = {
        invoiceNumber: `TEST-FAIL-${Date.now()}`,
        buyer: { name: "Test Client" },
        items: [
            { productId: product.id, description: product.name, quantity: product.stock + 1, price: 100 }
        ],
        subtotal: (product.stock + 1) * 100,
        total: (product.stock + 1) * 100,
        status: 'draft'
    };

    const res1 = await fetch('http://localhost:3000/api/invoices', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(invalidInvoice)
    });

    const data1 = await res1.json();
    if (res1.status === 400 && data1.error && data1.error.includes('Insufficient stock')) {
        console.log('✅ Success: Correctly blocked invoice due to insufficient stock.');
    } else {
        console.error(`❌ Failure: Expected 400 Insufficient stock, but got ${res1.status}`);
        console.log('Response body:', JSON.stringify(data1, null, 2));
    }

    // 4. Test: Aggregated Stock Reduction
    console.log('\nTest 2: Selling same product in multiple lines...');
    const validInvoice = {
        invoiceNumber: `TEST-AGG-${Date.now()}`,
        buyer: { name: "Test Client" },
        items: [
            { productId: product.id, description: product.name, quantity: 1, price: 100 },
            { productId: product.id, description: product.name, quantity: 2, price: 100 }
        ],
        subtotal: 3 * 100,
        total: 3 * 100,
        status: 'draft'
    };

    const res2 = await fetch('http://localhost:3000/api/invoices', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(validInvoice)
    });

    if (res2.ok) {
        console.log('✅ Success: Invoice created with aggregated items.');

        // Wait a bit for background stock update
        await new Promise(r => setTimeout(r, 2000));

        // Verify stock
        const prodResFinal = await fetch('http://localhost:3000/api/products', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const productsFinal = await prodResFinal.json();
        const updatedProduct = productsFinal.find(p => p.id === product.id);

        console.log(`Initial Stock: ${product.stock}, Expected reduction: 3, Final Stock: ${updatedProduct.stock}`);
        if (updatedProduct.stock === product.stock - 3) {
            console.log('✅ Success: Stock reduced correctly by aggregate amount.');
        } else {
            console.error('❌ Failure: Stock was not reduced correctly.');
        }
    } else {
        const txt = await res2.text();
        console.error(`❌ Failure: Could not create valid invoice: ${txt}`);
    }
}

verifyStockLogic();
