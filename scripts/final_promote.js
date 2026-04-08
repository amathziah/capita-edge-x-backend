import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const orgId = 'b89f089d-3766-47da-b75a-9f5715c579af';
    console.log('Upgrading Akoshipa org to pro tier...');
    
    // Step 1: Update the tier to 'pro' (which we verified is allowed by the DB)
    const { error } = await supabase.from('organizations').update({ plan_tier: 'pro' }).eq('id', orgId);
    
    if (!error) {
        console.log('✅ Successfully promoted Akoshipa to the 500 req/month tier (aliased as pro)!');
        
        // Step 2: Reset usage logs for this month to ensure a clean start
        const firstOfMonth = new Date();
        firstOfMonth.setDate(1);
        firstOfMonth.setHours(0, 0, 0, 0);

        await supabase.from('ai_requests')
            .delete()
            .eq('organization_id', orgId)
            .gte('created_at', firstOfMonth.toISOString());
            
        console.log('✅ Reset monthly AI usage logs.');
    } else {
        console.log('❌ Promotion failed:', error.message);
    }
}

run();
