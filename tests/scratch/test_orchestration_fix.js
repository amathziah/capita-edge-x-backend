import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import aiOrchestratorService from './src/modules/ai/aiOrchestrator.service.js';

async function test() {
    console.log("Testing Orchestration Fallback...");
    const queries = [
        "Who are my top regular customers right now?",
        "what are my overdue invoices?",
        "how much did I spend this month?"
    ];

    for (const query of queries) {
        console.log(`\nQuery: "${query}"`);
        const plan = await aiOrchestratorService.buildExecutionPlan(query, { organizationId: '11111111-1111-1111-1111-111111111111' });
        console.log("Intent:", plan.intent);
        console.log("Tools Selected:", plan.tools.map(t => t.toolId));
        
        if (plan.tools.length > 0) {
            console.log("✅ SUCCESS: At least one tool selected.");
        } else {
            console.error("❌ FAILURE: No tools selected for data-driven query!");
        }
    }
}

test();
