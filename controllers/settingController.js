import { supabase } from '../supabase.js';
import emailService from '../services/emailService.js';
import { APIError } from '../middleware/errorHandler.js';

// General Settings
export const getSettings = async (req, res) => {
    const { data: settings, error } = await supabase
        .from('settings')
        .select('*')
        .eq('organization_id', req.user.organizationId);

    if (error) throw new Error(error.message);

    const settingsObj = settings.reduce((acc, curr) => {
        let key = curr.key;
        const prefix = `${req.user.organizationId}:`;
        if (key.startsWith(prefix)) {
            key = key.replace(prefix, '');
        }
        acc[key] = curr.value;
        return acc;
    }, {});

    if (settingsObj.smtp_pass) {
        settingsObj.smtp_pass = '********';
    }

    res.json(settingsObj);
};

export const updateSetting = async (req, res) => {
    const { key, value } = req.body;

    if (!key) throw new APIError('Setting key is required', 400);

    const scopedKey = `${req.user.organizationId}:${key}`;

    const { error } = await supabase
        .from('settings')
        .upsert({
            key: scopedKey,
            value,
            organization_id: req.user.organizationId
        });

    if (error) throw new Error(error.message);
    res.json({ success: true });
};

// SMTP Test
export const testSmtpConnection = async (req, res) => {
    let { smtp_user, smtp_pass } = req.body;

    if (smtp_pass === '********') {
        const { data: settings, error } = await supabase
            .from('settings')
            .select('value')
            .eq('organization_id', req.user.organizationId)
            .eq('key', 'smtp_pass') // This needs scoped key check usually, but assumes key is just 'smtp_pass' in DB? 
            // Wait, previous logic used scoped keys for update but here checking 'smtp_pass'?
            // Logic in server.js: .eq('key', 'smtp_pass'). 
            // If we use scoped keys, this query might fail if it doesn't account for the prefix.
            // However, the original code used `req.user.organizationId` in the query which matches the column `organization_id`.
            // The `key` column might be just `smtp_pass` IF it's legacy data. 
            // BUT `updateSetting` uses `scopedKey`.
            // I should stick to original code logic: .eq('key', 'smtp_pass'). 
            // If it fails, users will re-save.
            .single();

        if (error || !settings) {
            // Try with scoped key if direct match fails
            const { data: scopedSettings } = await supabase.from('settings').select('value').eq('key', `${req.user.organizationId}:smtp_pass`).single();
            if (scopedSettings) smtp_pass = scopedSettings.value;
            else return res.status(400).json({ success: false, error: 'Could not retrieve saved password' });
        } else {
            smtp_pass = settings.value;
        }
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
    const { data: settings, error } = await supabase
        .from('settings')
        .select('key, value')
        .eq('organization_id', req.user.organizationId)
        .like('key', `%inv_%`);

    if (error) throw new Error(error.message);

    const prefix = `${req.user.organizationId}:`;
    const settingsObj = { ...INVENTORY_SETTING_DEFAULTS };

    if (settings) {
        settings.forEach(row => {
            let key = row.key;
            if (key.startsWith(prefix)) key = key.replace(prefix, '');
            if (key in settingsObj) {
                settingsObj[key] = row.value;
            }
        });
    }

    res.json(settingsObj);
};

export const updateInventorySettings = async (req, res) => {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
        throw new APIError('Request body must be an object', 400);
    }

    const validKeys = Object.keys(INVENTORY_SETTING_DEFAULTS);
    const entries = Object.entries(updates).filter(([key]) => validKeys.includes(key));

    if (entries.length === 0) throw new APIError('No valid keys', 400);

    const upserts = entries.map(([key, value]) => ({
        key: `${req.user.organizationId}:${key}`,
        value: String(value),
        organization_id: req.user.organizationId
    }));

    const { error } = await supabase
        .from('settings')
        .upsert(upserts);

    if (error) throw new Error(error.message);
    res.json({ success: true, updated: entries.length });
};
