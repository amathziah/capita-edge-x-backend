import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function updatePass() {
    console.log('Updating password for akoshipa@gmail.com...');
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
        console.error('Error listing users:', listError.message);
        return;
    }

    const user = users.find(u => u.email === 'akoshipa@gmail.com');
    if (user) {
        const { error } = await supabase.auth.admin.updateUserById(user.id, {
            password: 'CapitaTest123!',
            email_confirm: true
        });
        if (error) {
            console.error('Error updating user:', error.message);
        } else {
            console.log('✅ Successfully updated password to "CapitaTest123!" and confirmed email for akoshipa@gmail.com');
        }
    } else {
        console.error('❌ User akoshipa@gmail.com not found');
    }
}

updatePass();
