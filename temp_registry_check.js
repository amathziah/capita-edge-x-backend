import aiToolRegistryService from './src/modules/ai/aiToolRegistry.service.js';
console.log("Registered Tools:", aiToolRegistryService.getAllToolDeclarations().map(t => t.id));
