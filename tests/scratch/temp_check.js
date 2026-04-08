import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUser(email) {
  const { data: { users }, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.error('Error listing users:', error);
    return;
  }
  const user = users.find(u => u.email === email);
  if (user) {
    console.log('User found:', {
      id: user.id,
      email: user.email,
      confirmed: !!user.email_confirmed_at,
      last_sign_in: user.last_sign_in_at
    });
  } else {
    console.log('User not found in first page of listUsers');
  }
}

checkUser(process.argv[2]);
