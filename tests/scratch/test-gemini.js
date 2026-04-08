import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log('Testing Key:', apiKey ? 'FOUND' : 'MISSING');
    if (!apiKey) return;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Hi');
        const response = await result.response;
        console.log('Gemini Response:', response.text());
    } catch (error) {
        console.error('Gemini Error:', error);
        if (error.status) console.log('Status:', error.status);
    }
}

test();
