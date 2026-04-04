import dotenv from 'dotenv';
dotenv.config();
import aiService from '../src/modules/ai/ai.service.js';
import { supabase } from '../src/core/database/supabase.js';

async function verify() {
    console.log('🔍 Starting Plan Tier Verification...');
    
    // 1. Get a test organization
    const { data: orgs } = await supabase.from('organizations').select('id, name, plan_tier').limit(1);
    const testOrg = orgs?.[0];
    
    if (!testOrg) {
        console.error('❌ No organizations found.');
        process.exit(1);
    }
    
    console.log(`🏢 Org: ${testOrg.name} (${testOrg.id}) | Current Tier: ${testOrg.plan_tier}`);
    
    try {
        // 2. Check Budget Status
        const status = await aiService.getBudgetStatus('test-user', testOrg.id);
        console.log('✅ AI Service Budget Status:', JSON.stringify(status, null, 2));

        // 3. Test Routing Logic
        const budget = await aiService._checkPlanBudget(testOrg.id);
        console.log(`📡 Group models for ${budget.tier}:`, budget.models);
        
        if (testOrg.plan_tier === 'solo_pro' && !budget.models.includes('gemini-1.5-pro')) {
            console.error('❌ Solo Pro should use Gemini Pro!');
        } else if ((!testOrg.plan_tier || testOrg.plan_tier === 'free') && !budget.models.includes('gemini-1.5-flash-lite')) {
            console.error('❌ Free Tier should use Flash-Lite!');
        } else {
            console.log('✨ Model routing logic looks correct.');
        }

    } catch (e) {
        console.error('❌ Verification Failed:', e.message);
    }
}

verify();
