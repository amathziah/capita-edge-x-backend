import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import aiReadModelService from './src/modules/ai/aiReadModel.service.js';

async function test() {
    try {
        console.log("Calling getCustomerPortfolio...");
        const res = await aiReadModelService.getCustomerPortfolio('11111111-1111-1111-1111-111111111111');
        console.log("Success:", !!res.data.customers);
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
