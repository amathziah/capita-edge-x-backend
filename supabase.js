import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Prefer Service Role Key for Backend operations to bypass RLS when needed (Admin Context)
// If not present, falls back to Anon Key (which respects RLS, meaning raw queries might return empty if no user session is set)
// IMPORTANT: With Service Role Key, we must manually ensure tenant isolation (which we do in server.js via .eq('organization_id', ...))
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL or Key in environment variables');
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('⚠️ WARNING: SUPABASE_SERVICE_ROLE_KEY not found. Using Anon Key. DB queries might fail due to RLS if user session is not explicitly set.');
} else {
    console.log('✅ using SUPABASE_SERVICE_ROLE_KEY for admin database access.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);



