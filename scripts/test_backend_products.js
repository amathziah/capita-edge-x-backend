
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL or Key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBackend() {
    console.log('Logging in...');
    const { data: { session }, error } = await supabase.auth.signInWithPassword({
        email: 'test@example.com',
        password: 'password123'
    });

    if (error) {
        console.error('Login failed:', error.message);
        return;
    }

    const token = session.access_token;
    console.log('Login successful. Token acquired.');

    console.log('Fetching products from backend API...');
    try {
        const res = await fetch('http://localhost:3000/api/products', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!res.ok) {
            const txt = await res.text();
            console.error(`Status ${res.status}: ${txt}`);
            return;
        }

        const data = await res.json();
        console.log('Products fetched successfully:');
        console.log(JSON.stringify(data, null, 2));

    } catch (e) {
        console.error('Fetch failed:', e);
    }
}

testBackend();
