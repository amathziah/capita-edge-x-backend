const KEY_MAPPING = {
    businessName: 'business_name',
    business_name: 'business_name',
    companyTaxId: 'company_tax_id',
    company_tax_id: 'company_tax_id',
    email: 'email',
    phone: 'phone',
    address: 'address',
    ownerName: 'owner_name',
    owner_name: 'owner_name',
    paymentTerms: 'payment_terms',
    payment_terms: 'payment_terms',
    footerText: 'footer_text',
    footer_text: 'footer_text',
    invoiceNotes: 'invoice_notes',
    invoice_notes: 'invoice_notes',
    upiId: 'upi_id',
    upi_id: 'upi_id',
    bankDetails: 'bank_details',
    bank_details: 'bank_details',
    paymentInstructions: 'payment_instructions',
    payment_instructions: 'payment_instructions',
    currency: 'currency',
    taxLabel: 'tax_label',
    tax_label: 'tax_label',
    invoicePrefix: 'invoice_prefix',
    invoice_prefix: 'invoice_prefix',
    logoFilename: 'logo_filename',
    logo_filename: 'logo_filename',
    paymentQrFilename: 'payment_qr_filename',
    payment_qr_filename: 'payment_qr_filename',
    smtpUser: 'smtp_user',
    smtp_user: 'smtp_user',
    smtpPass: 'smtp_pass',
    smtp_pass: 'smtp_pass',
    gstin: 'gstin',
    pan: 'pan',
    frn: 'frn',
    state: 'state',
    city: 'city',
    pincode: 'pincode',
    msmeNumber: 'msme_number',
    msme_number: 'msme_number',
    lutNumber: 'lut_number',
    lut_number: 'lut_number',
    bankName: 'bank_name',
    bank_name: 'bank_name',
    bankAccountNumber: 'bank_account_number',
    bank_account_number: 'bank_account_number',
    bankIfsc: 'bank_ifsc',
    bank_ifsc: 'bank_ifsc',
    businessType: 'business_type',
    business_type: 'business_type',
    defaultDueDays: 'default_due_days',
    default_due_days: 'default_due_days',
    defaultGstRate: 'default_gst_rate',
    default_gst_rate: 'default_gst_rate',
    applyGstOnAllItems: 'apply_gst_on_all_items',
    apply_gst_on_all_items: 'apply_gst_on_all_items',
    isInterstate: 'is_interstate',
    is_interstate: 'is_interstate',
    freelanceCategory: 'freelance_category',
    freelance_category: 'freelance_category',
    customFreelanceCategory: 'custom_freelance_category',
    custom_freelance_category: 'custom_freelance_category',
    dailyRate: 'daily_rate',
    daily_rate: 'daily_rate',
    isGstRegistered: 'is_gst_registered',
    is_gst_registered: 'is_gst_registered',
    autoFollowUp: 'auto_follow_up',
    auto_follow_up: 'auto_follow_up',
    followUpDay1: 'follow_up_day_1',
    follow_up_day_1: 'follow_up_day_1',
    followUpDay2: 'follow_up_day_2',
    follow_up_day_2: 'follow_up_day_2',
    followUpDay3: 'follow_up_day_3',
    follow_up_day_3: 'follow_up_day_3',
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
