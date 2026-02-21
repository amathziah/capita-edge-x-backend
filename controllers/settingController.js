import { supabase } from '../supabase.js';
import emailService from '../services/emailService.js';
import { APIError } from '../middleware/errorHandler.js';
import { mapConfigToFrontend, mapKeyToDb } from '../utils/configUtils.js';

// General Settings
export const getSettings = async (req, res) => {
    const { data: config, error } = await supabase
        .from('organization_configs')
        .select('*')
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);

    // Return flattened object for compatibility, mapping back to camelCase
    const settingsObj = mapConfigToFrontend(config);

    // Scrub sensitive info (handled by Vault now, but for safety in old code)
    if (settingsObj.smtp_pass) {
        settingsObj.smtp_pass = '********';
    }

    res.json(settingsObj);
};

export const updateSetting = async (req, res) => {
    const { key, value } = req.body;

    if (!key) throw new APIError('Setting key is required', 400);

    const dbColumn = mapKeyToDb(key);

    // Dynamic update for columnar table
    if (dbColumn === 'smtp_pass' || key === 'smtp_pass') {
        // Store in Supabase Vault via RPC
        const { error } = await supabase.rpc('set_organization_secret', {
            p_organization_id: req.user.organizationId,
            p_name: 'smtp_pass',
            p_secret: value
        });
        if (error) throw new Error(error.message);
    } else {
        const { error } = await supabase
            .from('organization_configs')
            .upsert({
                organization_id: req.user.organizationId,
                [dbColumn]: value,
                updated_at: new Date()
            });
        if (error) throw new Error(error.message);
    }

    res.json({ success: true });
};

// SMTP Test
export const testSmtpConnection = async (req, res) => {
    let { smtp_user, smtp_pass } = req.body;

    if (smtp_pass === '********') {
        const { data: secret, error } = await supabase.rpc('get_organization_secret', {
            p_organization_id: req.user.organizationId,
            p_name: 'smtp_pass'
        });

        if (error || !secret) {
            return res.status(400).json({ success: false, error: 'Could not retrieve saved password from Vault' });
        }
        smtp_pass = secret;
    }

    const settings = { smtp_user, smtp_pass };
    const result = await emailService.testConnection(settings);
    res.json(result);
};

// Inventory Settings
const INVENTORY_SETTING_DEFAULTS = {
    inv_dead_stock_threshold: '60',
    inv_stockout_warning_days: '7',
    inv_velocity_window: '30',
    inv_overstocked_multiplier: '3',
    inv_default_reorder_level: '10',
    inv_low_stock_alerts: 'true',
    inv_dead_stock_alerts: 'true',
    inv_auto_reorder_suggestions: 'false',
    inv_show_velocity_badges: 'true',
    inv_show_cost_column: 'true',
    inv_valuation_method: 'weighted_avg'
};

export const getInventorySettings = async (req, res) => {
    const { data: config, error } = await supabase
        .from('organization_configs')
        .select('inventory_settings')
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error && error.code !== 'PGRST116') throw new Error(error.message);

    const settingsObj = {
        ...INVENTORY_SETTING_DEFAULTS,
        ...(config?.inventory_settings || {})
    };

    res.json(settingsObj);
};

export const updateInventorySettings = async (req, res) => {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
        throw new APIError('Request body must be an object', 400);
    }

    const { error } = await supabase
        .from('organization_configs')
        .upsert({
            organization_id: req.user.organizationId,
            inventory_settings: updates,
            updated_at: new Date()
        });

    if (error) throw new Error(error.message);
    res.json({ success: true });
};
