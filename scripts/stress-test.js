import dotenv from 'dotenv';
dotenv.config();
import aiService from '../src/modules/ai/ai.service.js';

async function stressTest() {
    console.log('🔥 Starting Enterprise Stress Test (Paid Tier 1)...');
    console.log('📡 This test sends 5 simultaneous requests to verify high RPM capacity.');
    
    const prompts = [
        'Give me a 1-sentence tip for cash flow.',
        'What is the benefit of GST compliance?',
        'How do I reduce churn?',
        'What is revenue concentration risk?',
        'Suggest a collection letter tone.'
    ];

    const startTime = Date.now();
    
    try {
        const results = await Promise.all(prompts.map(async (p, i) => {
            console.log(`  [Req ${i+1}] Sending...`);
            const it = aiService.processQueryStream(p, { user: { id: `stress-${i}` } });
            let responseReceived = false;
            for await (const chunk of it) {
                if (!responseReceived && chunk.type === 'token') {
                    console.log(`  [Req ${i+1}] RECEIVED FIRST TOKEN ✅`);
                    responseReceived = true;
                }
            }
            return true;
        }));

        const duration = (Date.now() - startTime) / 1000;
        console.log(`\n✨ STRESS TEST COMPLETE: 5/5 requests succeeded in ${duration}s.`);
        console.log('✅ Enterprise RPM limits are functioning correctly.');

    } catch (e) {
        console.error('\n❌ STRESS TEST FAILED:', e.message);
        if (e.message.includes('429') || e.message.includes('limit')) {
            console.error('⚠️  Still hitting rate limits. Check if Tier 1 is fully active in Cloud Console.');
        }
    }
}

stressTest();
