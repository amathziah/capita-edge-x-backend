import crypto from 'crypto';
import { supabase } from '../../core/database/supabase.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import emailService from '../../core/services/email.service.js';
import { DEFAULTS } from '../../core/config/constants.js';

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
 * Normalize a company name into a readable slug base.
 */
const normalizeOrganizationSlug = (companyName = '') => {
    const slug = companyName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return slug || 'organization';
};

/**
 * Supabase surfaces Postgres constraint errors as plain messages.
 */
const isDuplicateOrganizationSlugError = (error) => {
    const message = error?.message?.toLowerCase() ?? '';
    return message.includes('duplicate key value') && message.includes('organizations_slug_key');
};

/**
 * Create an organization while keeping slugs readable and collision-safe.
 */
const createOrganization = async (companyName) => {
    const baseSlug = normalizeOrganizationSlug(companyName);
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const slugSuffix = attempt === 0 ? '' : `-${crypto.randomBytes(2).toString('hex')}`;
        const slug = `${baseSlug}${slugSuffix}`;

        const { data: org, error: orgError } = await supabase
            .from('organizations')
            .insert([{
                name: companyName,
                slug,
                plan_tier: DEFAULTS.PLAN_TIER
            }])
            .select()
            .single();

        if (!orgError) {
            return org;
        }

        if (isDuplicateOrganizationSlugError(orgError) && attempt < maxAttempts - 1) {
            continue;
        }

        if (isDuplicateOrganizationSlugError(orgError)) {
            throw new Error(`Organization initialization failed: unable to allocate a unique slug for "${companyName}"`);
        }

        throw new Error(`Organization initialization failed: ${orgError.message}`);
    }

    throw new Error(`Organization initialization failed: unable to allocate a unique slug for "${companyName}"`);
};

/**
 * Helper to find a user by email via admin API (handles pagination)
 */
const findUserByEmail = async (email) => {
    const searchEmail = email.trim().toLowerCase();
    
    try {
        console.log(`[Auth] Searching for user: ${searchEmail} using admin listUsers...`);
        
        // Paginated search through the user directory (non-mutating)
        let page = 1;
        while (true) {
            const { data: { users, nextPageToken }, error } = await supabase.auth.admin.listUsers({
                page,
                perPage: 100 // Maximize capture per request
            });

            if (error) throw error;

            const foundUser = users.find(u => u.email?.toLowerCase() === searchEmail);
            if (foundUser) {
                console.log('[Auth] Found user via admin listUsers');
                return foundUser;
            }

            if (!nextPageToken) break;
            page++;
        }

        console.log('[Auth] Detected: NEITHER (New User).');
        return null;

    } catch (err) {
        console.error('[Auth] User lookup exception:', err);
        return null;
    }
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
        const profileUpdate = { id: userId, organization_id: orgId };
        if (businessType) {
            profileUpdate.business_type = businessType;
        }
        await supabase.from('profiles').upsert(profileUpdate);

        return res.status(200).json({
            success: true,
            alreadyProvisioned: true,
            organizationId: orgId
        });
    }

    let createdOrgId = null;
    try {
        // Use businessType from body, fallback to metadata (Fix Bug 2 & 8)
        const selectedPersona = businessType || req.user.user_metadata?.business_type || DEFAULTS.DEFAULT_PERSONA;

        // 2. Create the Organization
        const org = await createOrganization(companyName);
        createdOrgId = org.id;

        // 3. Link User as Owner
        const { error: linkError } = await supabase
            .from('organization_users')
            .insert([{
                organization_id: org.id,
                user_id: userId,
                role: 'owner'
            }]);

        if (linkError) throw new Error(`User linking failed: ${linkError.message}`);

        // 4. Create User Profile
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: userId,
                organization_id: org.id,
                business_type: selectedPersona,
                role: 'member'
            });

        if (profileError) throw new Error(`Profile synchronization failed: ${profileError.message}`);

        // 5. Seed Default Configs
        const { error: configError } = await supabase.from('organization_configs').insert([
            {
                organization_id: org.id,
                business_name: companyName,
                currency: DEFAULTS.CURRENCY,
                tax_label: DEFAULTS.TAX_LABEL,
                invoice_prefix: DEFAULTS.INVOICE_PREFIX,
                business_type: selectedPersona
            }
        ]);
        if (configError) throw new Error(`Configuration seeding failed: ${configError.message}`);

        // 6. Seed Invoice Sequences
        const { error: seqError } = await supabase.from('invoice_sequences').insert([
            {
                organization_id: org.id,
                last_number: 0,
                prefix: DEFAULTS.INVOICE_PREFIX,
                current_year: new Date().getFullYear(),
                reset_annually: true
            }
        ]);
        if (seqError) throw new Error(`Sequence initialization failed: ${seqError.message}`);

        res.status(201).json({
            success: true,
            organization: org
        });

    } catch (error) {
        console.error('[Provisioning Error]:', error);
        
        // ROLLBACK: If we have an orphaned org, remove it so user can retry cleanly
        if (createdOrgId) {
            console.log(`[Rollback] Cleaning up orphaned organization: ${createdOrgId}`);
            await supabase.from('organizations').delete().eq('id', createdOrgId);
        }
        
        // Final fallback: log the error for audit if rollback failed or seeding broke
        try {
            await supabase.from('provision_errors').insert([{
                user_id: userId,
                email: email,
                orphaned_org_id: createdOrgId,
                failed_step: error.message?.split(':')[0] ?? 'unknown',
                error_message: error.message
            }]);
        } catch (logErr) {
            console.error('[Provision] Failed to log error to audit table:', logErr);
        }
        
        throw new APIError(error.message || 'Provisioning failed', 500);
    }
};

/**
 * Resend confirmation email
 */
export const resendConfirmation = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        throw new APIError('Email is required', 400);
    }

    try {
        // 1. Fetch user by email to get ID (Use admin API to bypass RLS)
        const user = await findUserByEmail(email);

        if (!user) {
            // Standard practice: Don't reveal if email exists, but here we can be helpful or silent.
            // For resend, being helpful is usually fine.
            throw new APIError('No account found with this email.', 404);
        }

        if (user.email_confirmed_at) {
            throw new APIError('This account is already verified. Please sign in.', 400);
        }

        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(Date.now() + DEFAULTS.OTP_EXPIRY_MS).toISOString();

        // 2. Store in otp_verifications
        const { error: otpError } = await supabase
            .from('otp_verifications')
            .insert([{
                user_id: user.id,
                email: email,
                otp_hash: otpHash,
                expires_at: expiresAt
            }]);

        if (otpError) throw new Error(`Failed to store verification code: ${otpError.message}`);

        // 3. Send via EmailService
        await emailService.sendOtpEmail(email, otp);

        res.status(200).json({
            success: true,
            message: 'A new verification code has been sent to your email.'
        });

    } catch (error) {
        console.error('[Public Resend Error]:', error);
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

    if (String(password).length < DEFAULTS.MIN_PASSWORD_LENGTH) {
        throw new APIError(`Password must be at least ${DEFAULTS.MIN_PASSWORD_LENGTH} characters`, 400);
    }

    try {
        // 1. Create User in Supabase
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: {
                company_name: companyName,
                business_type: businessType || 'solopreneur'
            },
            email_confirm: false
        });

        if (userError) {
            // Handle existing user (Industry Practice)
            if (userError.message.includes('already registered') || userError.message.includes('already exists')) {
                console.log(`[Auth] Conflict for ${email}. Overriding with automatic resume...`);
                
                // FIX: Retrieve existing user to get their ID for the OTP record
                const existingUser = await findUserByEmail(email);
                if (!existingUser || !existingUser.id) {
                    throw new APIError('Could not locate existing account. Please contact support.', 404);
                }

                const otp = generateOTP();
                const otpHash = hashOTP(otp);
                const expiresAt = new Date(Date.now() + DEFAULTS.OTP_EXPIRY_MS).toISOString();

                // 2. Store in otp_verifications (Now including user_id)
                await supabase.from('otp_verifications').upsert({
                    user_id: existingUser.id,
                    email: email.trim().toLowerCase(),
                    otp_hash: otpHash,
                    expires_at: expiresAt
                }, { onConflict: 'email' });

                await emailService.sendOtpEmail(email, otp);
                
                return res.status(200).json({
                    success: true,
                    message: 'Welcome back! Your setup was interrupted. A fresh 6-digit code has been sent.'
                });
            }
            throw new APIError(userError.message, 400);
        }

        // 2. Generate and store OTP for new user
        await supabase
            .from('profiles')
            .upsert({
                id: userData.user.id,
                business_type: businessType || 'solopreneur'
            });

        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(Date.now() + DEFAULTS.OTP_EXPIRY_MS).toISOString();

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
