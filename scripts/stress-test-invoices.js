import dotenv from 'dotenv';
import { supabase } from '../supabase.js';
import * as invoiceController from '../controllers/invoiceController.js';

dotenv.config();

async function runStressTest() {
    const email = process.argv[2] || 'w3@gmail.com';
    console.log(`🔍 Looking for user: ${email}...`);

    const { data: userData, error: userError } = await supabase.auth.admin.listUsers();
    const user = userData?.users.find(u => u.email === email);

    if (!user) {
        console.error(`❌ User ${email} not found.`);
        return;
    }

    const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
    
    const testUser = {
        id: user.id,
        organizationId: profile.organization_id
    };

    const concurrency = 50;
    console.log(`🚀 Starting Stress Test for ${email}: ${concurrency} concurrent invoice creations...`);

    const startTime = Date.now();
    const results = [];

    const mockCreate = async (i) => {
        return new Promise(async (resolve) => {
            const req = {
                user: testUser,
                body: {
                    buyer: { name: `Stress Test Buyer ${i}` },
                    items: [{ description: 'Test Item', quantity: 1, price: 10 + i }],
                    notes: `Stress Test Run ${startTime}`
                }
            };

            const res = {
                status: (code) => ({
                    json: (data) => resolve({ id: i, code, data })
                }),
                json: (data) => resolve({ id: i, code: 200, data })
            };

            try {
                await invoiceController.createInvoice(req, res);
            } catch (error) {
                resolve({ id: i, code: error.statusCode || 500, error: error.message });
            }
        });
    };

    const taskPromises = [];
    for (let i = 0; i < concurrency; i++) {
        taskPromises.push(mockCreate(i));
    }

    const output = await Promise.all(taskPromises);
    const endTime = Date.now();

    const successes = output.filter(r => r.code === 201 || r.code === 200);
    const failures = output.filter(r => r.code !== 201 && r.code !== 200);

    console.log('\n--- 📊 Stress Test Results ---');
    console.log(`Total Attempts: ${concurrency}`);
    console.log(`Successes:      ${successes.length}`);
    console.log(`Failures:       ${failures.length}`);
    console.log(`Total Time:     ${(endTime - startTime) / 1000}s`);

    if (failures.length > 0) {
        console.log('\n❌ First 5 Failures:');
        console.log(failures.slice(0, 5));
    }

    if (successes.length > 0) {
        const numbers = successes.map(s => s.data.invoiceNumber).sort();
        const uniqueNumbers = new Set(numbers);
        console.log(`Unique INV #:   ${uniqueNumbers.size}`);

        if (uniqueNumbers.size !== successes.length) {
            console.log('❌ ERROR: Duplicate invoice numbers detected!');
        } else {
            console.log('✅ PASS: All invoice numbers are unique.');
        }
    }

    // Cleanup (optional but good)
    console.log('\n🧹 Cleaning up stress test data...');
    const { error: cleanupError } = await supabase
        .from('invoices')
        .delete()
        .eq('organization_id', testUser.organizationId)
        .ilike('notes', `%Stress Test Run ${startTime}%`);

    if (cleanupError) console.error('Cleanup Error:', cleanupError);
    else console.log('✅ Cleanup Complete');
}

runStressTest();
