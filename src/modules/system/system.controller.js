import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

import { supabase } from '../../core/database/supabase.js';
import emailService from '../../core/services/email.service.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { mapConfigToFrontend, mapKeyToDb } from '../../core/utils/configUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../../uploads');
const logoDir = path.join(uploadDir, 'logos');
const paymentQrDir = path.join(uploadDir, 'payment-qr');
const CONFIG_COLUMNS = new Set([
    'business_name',
    'company_tax_id',
    'email',
    'phone',
    'address',
    'payment_terms',
    'footer_text',
    'invoice_notes',
    'upi_id',
    'bank_details',
    'payment_instructions',
    'currency',
    'tax_label',
    'invoice_prefix',
    'logo_filename',
    'payment_qr_filename',
    'smtp_user',
    'inventory_settings',
    'gstin',
    'pan',
    'frn',
    'state',
    'city',
    'pincode',
    'msme_number',
    'lut_number',
    'bank_name',
    'bank_account_number',
    'bank_ifsc',
    'business_type',
    'default_due_days',
    'auto_follow_up',
    'follow_up_day_1',
    'follow_up_day_2',
    'follow_up_day_3',
    'dead_stock_threshold_days',
    'reorder_alerts_enabled',
    'mrr_alerts_enabled',
    'weekly_summary_enabled',
]);

fs.mkdirSync(logoDir, { recursive: true });
fs.mkdirSync(paymentQrDir, { recursive: true });

const buildFallbackConfig = async (organizationId) => {
    const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', organizationId)
        .single();

    if (organizationError) {
        throw new APIError(organizationError.message, 500);
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('business_type')
        .eq('organization_id', organizationId)
        .limit(1)
        .maybeSingle();

    return {
        organization_id: organizationId,
        business_name: organization?.name || 'Your Business',
        currency: 'INR',
        tax_label: 'GST',
        invoice_prefix: 'INV-',
        business_type: profile?.business_type || 'solopreneur',
        default_due_days: 30,
        inventory_settings: {},
    };
};

const getOrCreateOrganizationConfig = async (organizationId) => {
    const { data: existingConfig, error } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

    if (error) {
        throw new APIError(error.message, 500);
    }

    if (existingConfig) {
        return existingConfig;
    }

    const fallbackConfig = await buildFallbackConfig(organizationId);

    const { data: insertedConfig, error: insertError } = await supabase
        .from('organization_configs')
        .upsert(fallbackConfig)
        .select()
        .single();

    if (insertError) {
        throw new APIError(insertError.message, 500);
    }

    return insertedConfig;
};

export const uploadLogoMiddleware = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, logoDir),
        filename: (_req, file, callback) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            callback(null, `${Date.now()}-${safeName}`);
        }
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
});

export const uploadPaymentQrMiddleware = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, paymentQrDir),
        filename: (_req, file, callback) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            callback(null, `${Date.now()}-${safeName}`);
        }
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
});

export const getSettings = async (req, res) => {
    const config = await getOrCreateOrganizationConfig(req.user.organizationId);
    const settings = {
        ...mapConfigToFrontend(config),
        ...(config.inventory_settings || {}),
    };

    const smtpPass = await supabase.rpc('get_organization_secret', {
        p_organization_id: req.user.organizationId,
        p_name: 'smtp_pass'
    });

    if (!smtpPass.error && smtpPass.data) {
        settings.smtp_pass = smtpPass.data;
    }

    res.json(settings);
};

export const saveSetting = async (req, res) => {
    const { key, value } = req.body;

    if (!key) {
        throw new APIError('Setting key is required', 400);
    }

    await getOrCreateOrganizationConfig(req.user.organizationId);

    if (key === 'smtp_pass') {
        const { error } = await supabase.rpc('set_organization_secret', {
            p_organization_id: req.user.organizationId,
            p_name: 'smtp_pass',
            p_secret: value || ''
        });

        if (error) {
            throw new APIError(error.message, 500);
        }

        return res.json({ success: true });
    }

    const dbColumn = mapKeyToDb(key);

    if (!CONFIG_COLUMNS.has(dbColumn)) {
        const config = await getOrCreateOrganizationConfig(req.user.organizationId);
        const inventorySettings = {
            ...(config.inventory_settings || {}),
            [key]: value,
        };

        const { error } = await supabase
            .from('organization_configs')
            .upsert({
                organization_id: req.user.organizationId,
                inventory_settings: inventorySettings,
            });

        if (error) {
            throw new APIError(error.message, 500);
        }

        return res.json({ success: true, storedIn: 'inventory_settings' });
    }

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            [dbColumn]: value,
        });

    if (error) {
        throw new APIError(error.message, 500);
    }

    res.json({ success: true });
};

export const getInventorySettings = async (req, res) => {
    const config = await getOrCreateOrganizationConfig(req.user.organizationId);
    res.json(config.inventory_settings || {});
};

export const saveInventorySettings = async (req, res) => {
    await getOrCreateOrganizationConfig(req.user.organizationId);

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            inventory_settings: req.body || {},
        });

    if (error) {
        throw new APIError(error.message, 500);
    }

    res.json({ success: true });
};

export const testEmailConnection = async (req, res) => {
    const { smtp_user, smtp_pass } = req.body;

    if (!smtp_user || !smtp_pass) {
        throw new APIError('SMTP username and password are required', 400);
    }

    const result = await emailService.verifyConnection({
        smtp_user,
        smtp_pass,
    });

    if (!result.success) {
        return res.status(400).json(result);
    }

    res.json(result);
};

export const uploadLogo = async (req, res) => {
    if (!req.file) {
        throw new APIError('Logo file is required', 400);
    }

    await getOrCreateOrganizationConfig(req.user.organizationId);

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            logo_filename: req.file.filename,
        });

    if (error) {
        throw new APIError(error.message, 500);
    }

    res.json({
        filename: req.file.filename,
        url: `/api/uploads/logos/${req.file.filename}`,
    });
};

export const uploadPaymentQr = async (req, res) => {
    if (!req.file) {
        throw new APIError('Payment QR file is required', 400);
    }

    await getOrCreateOrganizationConfig(req.user.organizationId);

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            payment_qr_filename: req.file.filename,
        });

    if (error) {
        throw new APIError(error.message, 500);
    }

    res.json({
        filename: req.file.filename,
        url: `/api/uploads/payment-qr/${req.file.filename}`,
    });
};

export const runCatalogStressTest = async (req, res) => {
    res.status(410).json({ message: "This test has been decommissioned." });
};
