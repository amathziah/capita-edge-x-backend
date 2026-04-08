import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function promoteUser() {
    console.log('Promoting akoshipa@gmail.com to 500/req (solo_pro) category...');
    
    // 1. Find the user
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
        console.error('Error listing users:', listError.message);
        return;
    }

    const user = users.find(u => u.email === 'akoshipa@gmail.com');
    if (!user) {
        console.error('❌ User akoshipa@gmail.com not found');
        return;
    }

    // 2. Update profile tier
    const { error: profileError } = await supabase
        .from('profiles')
        .update({ tier: 'solo_pro' })
        .eq('id', user.id);

    if (profileError) {
        console.error('Error updating profile tier:', profileError.message);
    } else {
        console.log('✅ Updated profile tier to solo_pro');
    }

    // 3. Find organizations owned by this user and update their tier too
    const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('id')
        .eq('owner_id', user.id);

    if (orgError) {
        console.error('Error fetching organizations:', orgError.message);
    } else if (orgs && orgs.length > 0) {
        for (const org of orgs) {
            const { error: orgUpdateError } = await supabase
                .from('organizations')
                .update({ tier: 'solo_pro' })
                .eq('id', org.id);
            
            if (orgUpdateError) {
                console.error(`Error updating org ${org.id} tier:`, orgUpdateError.message);
            } else {
                console.log(`✅ Updated organization tier to solo_pro for org: ${org.id}`);
                
                // 4. Reset AI usage logs for this org to let them start fresh with 500 limit
                const { error: resetError } = await supabase
                    .from('ai_usage_logs')
                    .delete()
                    .eq('organization_id', org.id);
                
                if (resetError) {
                    console.error('Error resetting usage logs:', resetError.message);
                } else {
                    console.log('✅ Reset AI usage logs for fresca start');
                }
            }
        }
    } else {
        console.log('No organizations found for this user to update.');
    }
}

promoteUser();
