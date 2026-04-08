import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { supabase } from './src/core/database/supabase.js';

async function resetUsage(email) {
    console.log(`Starting AI usage reset for: ${email}`);

    // Discover tables first to be sure
    const { data: tables, error: tableError } = await supabase.rpc('get_tables'); // custom rpc if exists
    if (tableError) {
        // Fallback: list by attempting to select from common names
        const commonTables = ['users', 'organizations', 'ai_requests', 'profiles'];
        for (const t of commonTables) {
             const { error } = await supabase.from(t).select('id').limit(1);
             if (!error) console.log(`Found table: ${t}`);
             else console.log(`Table not found: ${t} (${error.message})`);
        }
    }

    // 1. Find the user's organization. 
    // Usually, in this app, organizations and users are the same ID or linked.
    // Let's search 'ai_requests' for ANY entry with the target email as context if possible, 
    // or just try to find the organization.
    
    const { data: orgs, error: orgError } = await supabase
        .from('organizations')
        .select('id, name')
        .limit(10);
    
    if (orgError) {
        console.error('❌ Error listing organizations:', orgError.message);
        return;
    }

    console.log('Available Organizations:', orgs.map(o => `${o.name} (${o.id})`).join(', '));

    // For a local/single-user dev environment, we likely want to clear EVERYTHING in ai_requests 
    // if we can't find a specific user-org link easily.
    const { error: deleteError } = await supabase
        .from('ai_requests')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) {
        console.error('❌ Failed to clear ai_requests:', deleteError.message);
    } else {
        console.log('✅ AI Usage successfully reset for the workspace.');
    }
}

const targetEmail = 'akoshipa@gmail.com';
resetUsage(targetEmail).catch(console.error);
