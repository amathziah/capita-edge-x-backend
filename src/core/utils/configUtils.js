const KEY_MAPPING = {
    businessName: 'business_name',
    companyTaxId: 'company_tax_id',
    email: 'email',
    phone: 'phone',
    address: 'address',
    paymentTerms: 'payment_terms',
    footerText: 'footer_text',
    invoiceNotes: 'invoice_notes',
    upiId: 'upi_id',
    bankDetails: 'bank_details',
    paymentInstructions: 'payment_instructions',
    currency: 'currency',
    tax_label: 'tax_label',
    invoice_prefix: 'invoice_prefix',
    logoFilename: 'logo_filename',
    logo_filename: 'logo_filename',
    smtp_user: 'smtp_user',
    gstin: 'gstin',
    pan: 'pan',
    frn: 'frn',
    state: 'state',
    city: 'city',
    pincode: 'pincode',
    msmeNumber: 'msme_number',
    lutNumber: 'lut_number',
    bankName: 'bank_name',
    bankAccountNumber: 'bank_account_number',
    bankIfsc: 'bank_ifsc',
    businessType: 'business_type',
    defaultDueDays: 'default_due_days',
    autoFollowUp: 'auto_follow_up',
    followUpDay1: 'follow_up_day_1',
    followUpDay2: 'follow_up_day_2',
    followUpDay3: 'follow_up_day_3',
    deadStockThresholdDays: 'dead_stock_threshold_days',
    reorderAlertsEnabled: 'reorder_alerts_enabled',
    mrrAlertsEnabled: 'mrr_alerts_enabled',
    weeklySummaryEnabled: 'weekly_summary_enabled'
};

const REVERSE_MAPPING = Object.fromEntries(
    Object.entries(KEY_MAPPING).map(([k, v]) => [v, k])
);

/**
 * Map database columns to frontend camelCase keys
 */
export const mapConfigToFrontend = (config) => {
    const settingsObj = {};
    if (config) {
        Object.entries(config).forEach(([col, val]) => {
            const frontendKey = REVERSE_MAPPING[col] || col;
            settingsObj[frontendKey] = val;
        });
    }
    return settingsObj;
};

/**
 * Map frontend camelCase keys to database columns
 */
export const mapKeyToDb = (key) => {
    return KEY_MAPPING[key] || key;
};
