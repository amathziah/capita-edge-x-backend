import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // Explicitly use models/ prefix
        const m = 'models/gemini-1.5-flash';
        console.log(`Checking ${m}...`);
        const model = genAI.getGenerativeModel({ model: m });
        const result = await model.generateContent('Hi');
        const response = await result.response;
        console.log(`✅ ${m} works! -> ${response.text().slice(0, 20)}`);
    } catch (e) {
        console.log(`❌ Failed: ${e.message}`);
    }
}

test();
