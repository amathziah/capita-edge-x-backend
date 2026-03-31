import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ORG_ID = '9d8de4aa-f112-448c-ab0e-68af9e63ccd5';

async function cleanup() {
    console.log('🧹 Cleaning up compliance tasks for Org: ' + ORG_ID);
    const { data: deleted, error } = await supabase
        .from('compliance_tasks')
        .delete()
        .eq('organization_id', ORG_ID)
        .select();

    if (error) {
        console.error('Error deleting tasks:', error);
    } else {
        console.log('Deleted ' + deleted.length + ' tasks.');
        deleted.forEach(t => console.log(`- ${t.type}`));
    }
}

cleanup();
