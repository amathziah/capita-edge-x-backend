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

async function findUser() {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) {
        console.error('Error listing users:', error);
        return;
    }

    const user = users.find(u => u.email === 'akoshipa@gmail.com');
    if (user) {
        console.log('USER_FOUND: ' + user.id);
        const { data: orgUser, error: orgError } = await supabase
            .from('organization_users')
            .select('organization_id')
            .eq('user_id', user.id)
            .maybeSingle();
        
        if (orgUser) {
            console.log('ORG_FOUND: ' + orgUser.organization_id);
        } else {
            console.log('ORG_NOT_FOUND');
        }
    } else {
        console.log('USER_NOT_FOUND');
    }
}

findUser();
