import dotenv from 'dotenv';
import { supabase } from '../supabase.js';
dotenv.config();

async function verifyOtpFlow() {
    const testEmail = `otp_test_${Date.now()}@example.com`;
    const testPassword = 'SignupPassword123!';
    const companyName = 'OTP Test Corp';
    const apiUrl = process.env.VITE_API_URL || `http://localhost:${process.env.PORT || 3000}/api`;

    console.log(`🚀 Verifying OTP Signup Flow for: ${testEmail}`);

    try {
        // 1. Signup
        console.log('📝 Attempting Signup...');
        const signupResponse = await fetch(`${apiUrl}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: testPassword, companyName }),
        });

        const signupData = await signupResponse.json();
        if (!signupResponse.ok) throw new Error(`Signup failed: ${signupData.error}`);
        console.log('✅ Signup Success:', signupData.message);

        // 2. Fetch OTP from Supabase (for testing only)
        console.log('🔍 Fetching OTP from Supabase metadata...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        const user = users.find(u => u.email === testEmail);

        if (!user) throw new Error('User not found in Supabase after signup');
        const otp = user.user_metadata?.otp;
        if (!otp) throw new Error('OTP not found in user metadata');
        console.log(`✅ Retrieved OTP: ${otp}`);

        // 3. Verify OTP
        console.log('🔐 Attempting OTP Verification...');
        const verifyResponse = await fetch(`${apiUrl}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, otp }),
        });

        const verifyData = await verifyResponse.json();
        if (!verifyResponse.ok) throw new Error(`Verification failed: ${verifyData.error}`);
        console.log('✅ Verification Success:', verifyData.message);

        // 4. Cleanup
        console.log('🧹 Cleaning up test user...');
        await supabase.auth.admin.deleteUser(user.id);
        console.log('✅ Test User Deleted');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

verifyOtpFlow();
