import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function confirmUser(email) {
    console.log(`🔍 Searching for user with email: ${email}...`);

    // 1. Find user
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
        console.error('❌ Error listing users:', listError.message);
        return;
    }

    const user = users.find(u => u.email === email);

    if (!user) {
        console.error(`❌ User with email ${email} not found.`);
        return;
    }

    console.log(`✅ Found user: ${user.id}. Confirming...`);

    // 2. Confirm user
    const { data, error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        { email_confirm: true }
    );

    if (updateError) {
        console.error('❌ Error confirming user:', updateError.message);
    } else {
        console.log(`🚀 User ${email} successfully confirmed! You can now log in.`);
    }
}

const targetEmail = process.argv[2];
if (!targetEmail) {
    console.log('💡 Usage: node confirm_user.js your-email@example.com');
} else {
    confirmUser(targetEmail);
}
