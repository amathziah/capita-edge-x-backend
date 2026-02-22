import { supabase } from '../supabase.js';

async function verifyPlanStatus() {
    console.log('🚀 Starting Plan Status Verification...');

    try {
        // 1. Get a test user organization
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .select('id, plan_tier')
            .limit(1)
            .single();

        if (orgError || !org) {
            console.error('❌ Could not find a test organization');
            return;
        }

        console.log(`✅ Found Org: ${org.id} (${org.plan_tier})`);

        // 2. Count Invoices
        const { count: invoiceCount } = await supabase
            .from('invoices')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id);

        console.log(`📊 Invoices: ${invoiceCount}`);

        // 3. Count AI Requests
        const today = new Date().toISOString().split('T')[0];
        const { count: aiCount } = await supabase
            .from('ai_requests')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', org.id)
            .gte('created_at', today);

        console.log(`🤖 AI Requests Today: ${aiCount}`);

        console.log('\n✨ Backend Verification Successful!');
    } catch (err) {
        console.error('❌ Verification Failed:', err);
    }
}

verifyPlanStatus();
