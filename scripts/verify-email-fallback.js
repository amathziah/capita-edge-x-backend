import { supabase } from '../supabase.js';
import emailService from '../services/emailService.js';
import dotenv from 'dotenv';
dotenv.config();

async function testEmailFallback() {
    const testEmail = `test_${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    console.log(`🚀 Starting verification for email: ${testEmail}`);

    try {
        // 1. Create a dummy user first (unconfirmed)
        console.log('👤 Creating dummy user...');
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email: testEmail,
            password: testPassword,
            email_confirm: false
        });

        if (userError) {
            console.error('❌ User Creation Failed:', userError.message);
            return;
        }

        console.log('✅ User Created Successfully');

        // 2. Generate Supabase confirmation link
        console.log('🔗 Generating Supabase confirmation link...');
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'signup',
            email: testEmail,
            options: {
                redirectTo: process.env.APP_URL || 'http://localhost:5173'
            }
        });

        if (linkError) {
            console.error('❌ Link Generation Failed:', linkError.message);
            // Cleanup on failure
            await supabase.auth.admin.deleteUser(userData.user.id);
            return;
        }

        const confirmationLink = linkData.properties.action_link;
        console.log('✅ Link Generated Successfully:', confirmationLink);

        // 3. Send via our EmailService
        console.log('📧 Attempting to send email via EmailService...');
        const result = await emailService.sendConfirmationEmail(testEmail, confirmationLink);

        if (result.success) {
            console.log('✅ Email Service Reported Success:', result.messageId);
        } else {
            console.log('❌ Email Service Reported Failure');
        }

        // 4. Cleanup
        console.log('🧹 Cleaning up dummy user...');
        await supabase.auth.admin.deleteUser(userData.user.id);
        console.log('✅ Cleanup Complete');

    } catch (error) {
        console.error('❌ Unexpected Error during verification:', error);
    }
}

testEmailFallback();
