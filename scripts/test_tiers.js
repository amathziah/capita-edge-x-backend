import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const orgId = 'b89f089d-3766-47da-b75a-9f5715c579af';
    const guesses = ['starter', 'solo', 'solo_pro', 'pro', 'premium', 'enterprise', 'free', 'basic', 'plus', 'business'];
    
    console.log('Testing tiers for org:', orgId);
    
    for (const guess of guesses) {
        process.stdout.write(`Testing ${guess}... `);
        const { error } = await supabase.from('organizations').update({ plan_tier: guess }).eq('id', orgId);
        if (!error) {
            console.log('✅ VALID');
        } else {
            console.log(`❌ INVALID (${error.message})`);
        }
    }
}

run();
