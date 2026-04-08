import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function promote() {
    const orgId = 'b89f089d-3766-47da-b75a-9f5715c579af';
    console.log(`Setting organization ${orgId} to 'solo_pro' tier...`);

    const { error: updateError } = await supabase
        .from('organizations')
        .update({ plan_tier: 'solo_pro' })
        .eq('id', orgId);

    if (updateError) {
        console.error('Error updating organization:', updateError.message);
        return;
    }

    console.log('✅ Successfully updated organization tier to solo_pro (500 queries/month)');

    // Optional: Reset usage logs for this month to ensure they have the full 500
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const { error: deleteError } = await supabase
        .from('ai_requests')
        .delete()
        .eq('organization_id', orgId)
        .gte('created_at', firstOfMonth.toISOString());

    if (deleteError) {
        console.error('Note: Could not reset ai_requests logs:', deleteError.message);
    } else {
        console.log('✅ Reset monthly AI usage logs for Akoshipa.');
    }
}

promote();
