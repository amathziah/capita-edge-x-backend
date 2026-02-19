import autocannon from 'autocannon';
import dotenv from 'dotenv';

dotenv.config();

const url = `http://localhost:${process.env.PORT || 3000}`;
const bypassToken = 'mock-token-xyz-developer-bypass';
const orgId = '8fc38c6b-6cc8-4e5b-9ee8-4a235170c6c9';

async function runBenchmark(path, name) {
    console.log(`🔥 Starting benchmark: ${name} (${path})`);

    const result = await autocannon({
        url: `${url}${path}`,
        connections: 50, // 50 concurrent connections
        duration: 10,   // 10 seconds per test
        headers: {
            'Authorization': `Bearer ${bypassToken}`,
            'x-organization-id': orgId
        }
    });

    console.log(`-----------------------------------`);
    console.log(`📊 Result for: ${name}`);
    console.log(`Requests/sec: ${result.requests.average}`);
    console.log(`Latency (avg/p99): ${result.latency.average}ms / ${result.latency.p99}ms`);
    console.log(`Total Errors: ${result.errors + result.timeouts}`);
    console.log(`-----------------------------------`);
    return result;
}

async function main() {
    console.log('--- SYSTEM STRESS TEST ---');

    // Test Read Invoices (List)
    await runBenchmark('/api/invoices', 'List Invoices');

    // Test Read Customers (List)
    await runBenchmark('/api/customers', 'List Customers');

    // Test Analytics Dashboard (Heavy aggregation)
    await runBenchmark('/api/analytics/dashboard', 'Dashboard Stats');

    console.log('✅ Stress test completed.');
}

main().catch(console.error);
