import dotenv from 'dotenv';
dotenv.config();
import { supabase } from '../src/core/database/supabase.js';
import analyticsService from '../src/modules/analytics/analytics.service.js';

async function verify() {
    console.log('🔍 Starting Data Verification...');
    
    // 1. Get a test organization ID
    const { data: orgs } = await supabase.from('organizations').select('id').limit(1);
    const orgId = orgs?.[0]?.id;
    
    if (!orgId) {
        console.error('❌ No organizations found in database.');
        process.exit(1);
    }
    
    console.log(`🏢 Testing with Org ID: ${orgId}`);
    
    try {
        // 2. Test getDashboardStats (Checks snake_case mapping)
        const stats = await analyticsService.getDashboardStats(orgId);
        console.log('✅ Dashboard Stats:', JSON.stringify(stats, null, 2));
        
        // 3. Test getSafeToSpend (Checks snake_case mapping for payments/invoices)
        const liquidity = await analyticsService.getSafeToSpend(orgId);
        console.log('✅ Safe to Spend:', JSON.stringify(liquidity, null, 2));
        
        // 4. Check if we actually got non-zero values (if data exists)
        const { count } = await supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('organization_id', orgId);
        console.log(`📊 Total Invoices in DB: ${count}`);
        
        if (count > 0 && stats.total_revenue === 0 && stats.pending_payments === 0) {
            console.error('❌ CRITICAL: Invoices exist but stats are $0. Column mapping failed!');
            process.exit(1);
        } else {
            console.log('✨ Data retrieval successful and mapped properly.');
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error.message);
        process.exit(1);
    }
}

verify();
