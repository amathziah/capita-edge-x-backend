import aiIntentService from '../src/modules/ai/aiIntent.service.js';
import aiToolRegistryService from '../src/modules/ai/aiToolRegistry.service.js';

const prompts = [
  'hi',
  'what can you do here?',
  'which invoices need attention right now?',
  'what payments came in recently?',
  'what are we spending on this month?',
  'how are we doing?',
  'what is my cash flow right now?',
];

async function main() {
  const rows = [];

  for (const query of prompts) {
    const intent = aiIntentService.detect(query);
    const meta = aiIntentService.getMetadata(intent);
    const tools = await aiToolRegistryService.planTools(query, {});
    rows.push({
      query,
      intent,
      domain: meta.domain,
      specialist: meta.specialistLabel,
      tools: tools.map((tool) => tool.toolId),
    });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
