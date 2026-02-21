import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function dropColumn() {
    console.log('🚀 Attempting to drop column promptDetails from ai_requests...');

    // Note: Standard Supabase Client doesn't have a direct 'drop column' method.
    // We usually use migrations or the SQL editor. 
    // However, if the RPC 'execute_sql' is enabled (rare but possible), we'd use that.
    // Otherwise, we'll try to use the DATABASE_URL via pg client to be certain.

    console.log('⚠️  Standard client cannot drop columns. Please use the Supabase SQL Editor:');
    console.log('   ALTER TABLE public.ai_requests DROP COLUMN IF EXISTS "promptDetails";');

    // I will try to use the DATABASE_URL if available
    try {
        const pg = await import('pg');
        const client = new pg.default.Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        await client.connect();
        await client.query('ALTER TABLE public.ai_requests DROP COLUMN IF EXISTS "promptDetails";');
        console.log('✅ Success! Column "promptDetails" dropped from ai_requests.');
        await client.end();
    } catch (err) {
        console.error('❌ Failed to drop column via DATABASE_URL:', err.message);
        console.log('   If DATABASE_URL is not set, please run the SQL manually in Supabase Dashboard.');
    }
}

dropColumn();
