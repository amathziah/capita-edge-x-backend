import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';
import emailService from '../services/emailService.js';

// Helper to ensure URL has protocol
const ensureProtocol = (url) => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
};

// Helper to generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Provision a new organization for a user
 * This is called AFTER Supabase Auth signup
 */
export const provisionOrganization = async (req, res) => {
    const { companyName } = req.body;
    const userId = req.user.id;

    if (!companyName) {
        throw new APIError('Company name is required', 400);
    }

    // 1. Check if user already has an organization
    const { data: existingOrg } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1);

    if (existingOrg && existingOrg.length > 0) {
        return res.status(400).json({
            error: 'User already belongs to an organization',
            organizationId: existingOrg[0].organization_id
        });
    }

    try {
        // 2. Create the Organization
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .insert([{
                name: companyName,
                slug: companyName.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, ''),
                plan_tier: 'starter'
            }])
            .select()
            .single();

        if (orgError) throw new Error(`Org Creation Failed: ${orgError.message}`);

        // 3. Link User as Owner
        const { error: linkError } = await supabase
            .from('organization_users')
            .insert([{
                organization_id: org.id,
                user_id: userId,
                role: 'owner'
            }]);

        if (linkError) throw new Error(`User Linking Failed: ${linkError.message}`);

        // 4. Seed Default Configs
        await supabase.from('organization_configs').insert([
            {
                organization_id: org.id,
                business_name: companyName,
                currency: 'INR',
                tax_label: 'GST',
                invoice_prefix: 'INV-'
            }
        ]);

        // 5. Seed Default Accounts for COA
        await supabase.from('accounts').insert([
            { organization_id: org.id, name: 'Accounts Receivable', account_type: 'asset' },
            { organization_id: org.id, name: 'Sales Revenue', account_type: 'revenue' },
            { organization_id: org.id, name: 'Bank', account_type: 'asset' },
            { organization_id: org.id, name: 'Cash on Hand', account_type: 'asset' }
        ]);

        res.status(201).json({
            success: true,
            organization: org
        });

    } catch (error) {
        console.error('[Provisioning Error]:', error);
        throw new APIError(error.message || 'Provisioning failed', 500);
    }
};

/**
 * Resend confirmation email using backend SMTP as fallback
 */
export const resendConfirmation = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new APIError('Email is required', 400);
    }

    try {
        const otp = generateOTP();

        // 1. Update user metadata with new OTP
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            // We need to find the user first to get their ID, or use email if supported by admin.updateUser
            // Supabase admin.updateUser requires ID. Let's get user by email.
            null, // This is a bit tricky if we don't have ID.
            { user_metadata: { otp: otp, otp_sent_at: new Date().toISOString() } }
        );
        // Wait, admin.updateUserById is the correct one but needs id.
        // Let's find user by email first.
        const { data: { users }, error: findError } = await supabase.auth.admin.listUsers();
        const user = users.find(u => u.email === email);

        if (findError || !user) {
            throw new APIError('User not found', 404);
        }

        const { error: otpUpdateError } = await supabase.auth.admin.updateUserById(
            user.id,
            { user_metadata: { ...user.user_metadata, otp: otp, otp_sent_at: new Date().toISOString() } }
        );

        if (otpUpdateError) {
            console.error('[OTP Update Error]:', otpUpdateError);
            throw new APIError(otpUpdateError.message, 400);
        }

        // 2. Send via our EmailService
        await emailService.sendOtpEmail(email, otp);

        res.status(200).json({
            success: true,
            message: 'A new verification code has been sent to your email.'
        });

    } catch (error) {
        console.error('[Resend Confirmation Error]:', error);
        throw new APIError(error.message || 'Failed to resend confirmation', 500);
    }
};

/**
 * Verify OTP and confirm user account
 */
export const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new APIError('Email and OTP are required', 400);
    }

    try {
        // 1. Find user by email
        const { data: { users }, error: findError } = await supabase.auth.admin.listUsers();
        const user = users.find(u => u.email === email);

        if (findError || !user) {
            throw new APIError('User not found', 404);
        }

        // 2. Validate OTP
        const storedOtp = user.user_metadata?.otp;
        const otpSentAt = user.user_metadata?.otp_sent_at;

        if (!storedOtp || storedOtp !== otp) {
            throw new APIError('Invalid verification code', 400);
        }

        // Optional: Check expiration (e.g., 10 minutes)
        if (otpSentAt) {
            const sentTime = new Date(otpSentAt).getTime();
            const now = new Date().getTime();
            if (now - sentTime > 10 * 60 * 1000) {
                throw new APIError('Verification code has expired. Please request a new one.', 400);
            }
        }

        // 3. Confirm User
        const { error: confirmError } = await supabase.auth.admin.updateUserById(
            user.id,
            {
                email_confirm: true,
                user_metadata: { ...user.user_metadata, otp: null, otp_sent_at: null } // Clear OTP
            }
        );

        if (confirmError) {
            console.error('[OTP Confirmation Error]:', confirmError);
            throw new APIError(confirmError.message, 400);
        }

        res.status(200).json({
            success: true,
            message: 'Email verified successfully! You can now sign in.'
        });

    } catch (error) {
        console.error('[Verify OTP Error]:', error);
        throw new APIError(error.message || 'Verification failed', 500);
    }
};

/**
 * Sign up a new user via Backend to ensure SMTP emails
 */
export const signUp = async (req, res) => {
    const { email, password, companyName } = req.body;

    if (!email || !password || !companyName) {
        throw new APIError('Email, password, and company name are required', 400);
    }

    try {
        const otp = generateOTP();

        // 1. Create User in Supabase (Admin API)
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: {
                company_name: companyName,
                otp: otp,
                otp_sent_at: new Date().toISOString()
            },
            email_confirm: false
        });

        if (userError) {
            console.error('[Signup User Creation Error]:', userError);
            throw new APIError(userError.message, 400);
        }

        // 2. Send via SMTP
        await emailService.sendOtpEmail(email, otp);

        res.status(201).json({
            success: true,
            message: 'Account created! Please check your email for the 6-digit verification code.'
        });

    } catch (error) {
        console.error('[Backend Signup Error]:', error);
        throw new APIError(error.message || 'Signup failed', 500);
    }
};
