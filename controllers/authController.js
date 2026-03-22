import crypto from 'crypto';
import { supabase } from '../supabase.js';
import { APIError } from '../middleware/errorHandler.js';
import emailService from '../services/emailService.js';

/**
 * Helper to hash OTP for secure storage
 */
const hashOTP = (otp) => {
    return crypto.createHash('sha256').update(otp).digest('hex');
};

/**
 * Helper to generate 6-digit OTP
 */
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Provision a new organization for a user
 */
export const provisionOrganization = async (req, res) => {
    const { companyName, businessType } = req.body;
    const userId = req.user.id;
    const email = req.user.email;

    if (!companyName) {
        throw new APIError('Company name is required', 400);
    }

    // 1. Check if user already has an organization (Fix Bug 1: 200 on existing)
    const { data: existingOrg } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1);

    if (existingOrg && existingOrg.length > 0) {
        const orgId = existingOrg[0].organization_id;
        
        // Ensure profile has this organizationId and businessType (Self-healing)
        const profileUpdate = { organization_id: orgId };
        if (businessType) {
            profileUpdate.business_type = businessType;
        }
        await supabase.from('profiles').update(profileUpdate).eq('id', userId);

        return res.status(200).json({
            success: true,
            alreadyProvisioned: true,
            organizationId: orgId
        });
    }

    try {
        // Use businessType from body, fallback to metadata (Fix Bug 2 & 8)
        const selectedPersona = businessType || req.user.user_metadata?.business_type || 'solopreneur';

        // 2. Create the Organization
        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .insert([{
                name: companyName,
                slug: companyName.toLowerCase().replace(/ /g, '-').replace(/[^\w-]/g, ''),
                plan_tier: 'free'
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

        // 4. Create User Profile (Fix Bug 3 & Redirect Loop)
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                organization_id: org.id,
                business_type: selectedPersona,
                role: 'member'
            });

        if (profileError) throw new Error(`Profile creation failed: ${profileError.message}`);

        // 5. Seed Default Configs
        await supabase.from('organization_configs').insert([
            {
                organization_id: org.id,
                business_name: companyName,
                currency: 'INR',
                tax_label: 'GST',
                invoice_prefix: 'INV-',
                business_type: selectedPersona
            }
        ]);

        // 6. Seed Invoice Sequences (Fix Bug 4)
        await supabase.from('invoice_sequences').insert([
            {
                organization_id: org.id,
                last_number: 0,
                prefix: 'INV-',
                current_year: new Date().getFullYear(),
                reset_annually: true
            }
        ]);

        // 7. Seed Default Accounts
        await supabase.from('accounts').insert([
            { organization_id: org.id, name: 'Accounts Receivable', account_type: 'asset' },
            { organization_id: org.id, name: 'Sales Revenue', account_type: 'revenue' },
            { organization_id: org.id, name: 'Bank', account_type: 'asset' },
            { organization_id: org.id, name: 'Cash on Hand', account_type: 'asset' }
        ]);
        
        // Step 8: Seed compliance tasks for freelancer and service firm
        if (selectedPersona === 'solopreneur' || selectedPersona === 'services_firm') {
            const now = new Date();
            const currentYear = now.getFullYear();
            
            // Next month for GST filing dates
            const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const nextYear = nextMonthDate.getFullYear();
            const nextMonth = String(nextMonthDate.getMonth() + 1).padStart(2, '0');

            const complianceTasks = [
                {
                    organization_id: org.id,
                    type: 'GST Filing',
                    description: 'File GSTR-1 — outward supplies return for previous month',
                    due_date: `${nextYear}-${nextMonth}-11`,
                    status: 'pending',
                    priority: 'high',
                    notes: 'File by 11th of every month on GST portal'
                },
                {
                    organization_id: org.id,
                    type: 'GST Filing',
                    description: 'File GSTR-3B — monthly tax payment return',
                    due_date: `${nextYear}-${nextMonth}-20`,
                    status: 'pending',
                    priority: 'high',
                    notes: 'Pay net GST liability and file by 20th of every month'
                },
                {
                    organization_id: org.id,
                    type: 'Advance Tax',
                    description: 'Q1 Advance Tax — pay 15% of estimated annual tax liability',
                    due_date: `${currentYear}-06-15`,
                    status: 'pending',
                    priority: 'medium',
                    notes: 'Section 208 — mandatory if tax liability > ₹10,000/year'
                },
                {
                    organization_id: org.id,
                    type: 'Advance Tax',
                    description: 'Q2 Advance Tax — cumulative 45% of annual liability',
                    due_date: `${currentYear}-09-15`,
                    status: 'pending',
                    priority: 'medium',
                    notes: 'Pay on NSDL portal using Challan 280'
                },
                {
                    organization_id: org.id,
                    type: 'Advance Tax',
                    description: 'Q3 Advance Tax — cumulative 75% of annual liability',
                    due_date: `${currentYear}-12-15`,
                    status: 'pending',
                    priority: 'medium',
                    notes: 'Pay on NSDL portal using Challan 280'
                },
                {
                    organization_id: org.id,
                    type: 'Advance Tax',
                    description: 'Q4 Final Advance Tax — 100% of annual liability',
                    due_date: `${currentYear + 1}-03-15`,
                    status: 'pending',
                    priority: 'high',
                    notes: 'Final payment — shortfall attracts interest under Section 234B/234C'
                },
                {
                    organization_id: org.id,
                    type: 'TDS',
                    description: 'Request Form 16A from all clients who deducted TDS this year',
                    due_date: `${currentYear}-06-15`,
                    status: 'pending',
                    priority: 'medium',
                    notes: 'Form 16A needed to claim TDS credit in your ITR. Client must issue by 15 June.'
                },
            ];

            await supabase.from('compliance_tasks').insert(complianceTasks);
        }

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
 * Resend confirmation email
 */
export const resendConfirmation = async (req, res) => {
    const email = req.user.email; // From authenticateUser middleware
    const userId = req.user.id;

    try {
        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

        // 1. Store in otp_verifications (Fix Bugs 5, 6, 7)
        const { error: otpError } = await supabase
            .from('otp_verifications')
            .insert([{
                user_id: userId,
                email: email,
                otp_hash: otpHash,
                expires_at: expiresAt
            }]);

        if (otpError) throw new Error(`Failed to store verification code: ${otpError.message}`);

        // 2. Send via EmailService
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
        const otpHash = hashOTP(otp);

        // 1. Find valid OTP (Fix Bug 5: bypass pagination)
        const { data: verification, error: otpError } = await supabase
            .from('otp_verifications')
            .select('*')
            .eq('email', email)
            .eq('otp_hash', otpHash)
            .is('used_at', null)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (otpError || !verification) {
            throw new APIError('Invalid or expired verification code', 400);
        }

        // 2. Mark OTP as used
        await supabase
            .from('otp_verifications')
            .update({ used_at: new Date().toISOString() })
            .eq('id', verification.id);

        // 3. Confirm User via Admin API
        const { error: confirmError } = await supabase.auth.admin.updateUserById(
            verification.user_id,
            { email_confirm: true }
        );

        if (confirmError) throw confirmError;

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
 * Sign up a new user
 */
export const signUp = async (req, res) => {
    const { email, password, companyName, businessType } = req.body;

    if (!email || !password || !companyName) {
        throw new APIError('Email, password, and company name are required', 400);
    }

    try {
        // 1. Create User in Supabase (Confirm Bug 8: businessType saved in metadata)
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: {
                company_name: companyName,
                business_type: businessType || 'solopreneur'
            },
            email_confirm: false
        });

        if (userError) throw new APIError(userError.message, 400);

        // 2. Generate and store OTP (Fix Bug 6: Secure Hashing)
        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        await supabase
            .from('otp_verifications')
            .insert([{
                user_id: userData.user.id,
                email: email,
                otp_hash: otpHash,
                expires_at: expiresAt
            }]);

        // 3. Send via SMTP
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
