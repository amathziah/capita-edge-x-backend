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
    smtp_user: 'smtp_user'
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
