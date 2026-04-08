import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { supabase } from './src/core/database/supabase.js';

async function test() {
    try {
        const { data, error } = await supabase
            .from('ai_tool_traces')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);
        if (error) throw error;
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}
test();
