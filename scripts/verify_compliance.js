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

async function verify() {
    const orgId = 'ae0359e0-d301-4221-8a93-aa139d7a626c';
    const { count, error } = await supabase
        .from('compliance_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId);

    if (error) console.error(error);
    else console.log(`Organization ${orgId} has ${count} compliance tasks.`);
}
verify();
