import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // List models is not directly available in the same way in the SDK,
        // but we can try common ones.
        const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro', 'gemini-1.0-pro'];
        
        for (const m of models) {
            try {
                console.log(`Checking ${m}...`);
                const model = genAI.getGenerativeModel({ model: m });
                const result = await model.generateContent('Hi');
                const response = await result.response;
                console.log(`✅ ${m} works! -> ${response.text().slice(0, 20)}`);
                break;
            } catch (e) {
                console.log(`❌ ${m} failed: ${e.message}`);
            }
        }
    } catch (error) {
        console.error('Core Error:', error);
    }
}

test();
