import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log(`\n🔍 reminders`);
    const { data, error } = await supabase.from('reminders').select('*').limit(1);
    if (error) console.log(error.message);
    else if (data.length) console.log(Object.keys(data[0]).join(', '));
    else console.log('Empty - attempting to infer from code or migration if possible, checking structure...');
}
inspect();
