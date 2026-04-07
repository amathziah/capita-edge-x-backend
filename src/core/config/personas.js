export const PERSONA_META = {
    solopreneur: {
        label: 'SOLO', color: '#34d399', colorDim: '#34d39960',
        colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
        robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
        greeting: "Hey! I'm **Capita**. I can work directly with your invoices, payments, expenses, and compliance data. What do you want to inspect?"
    },
    subscription: {
        label: 'SaaS', color: '#818cf8', colorDim: '#818cf860',
        colorBg: '#818cf812', colorBorder: '#818cf835', colorGlow: '#818cf830',
        robotColor: '#818cf8', robotEye: '#eef2ff', robotBg: '#1e1b4b',
        greeting: "Systems nominal. **Capita** online with live invoice, payment, expense, and compliance data. Which workspace do you want to open?"
    },
    services_firm: {
        label: 'AGENCY', color: '#fbbf24', colorDim: '#fbbf2460',
        colorBg: '#fbbf2412', colorBorder: '#fbbf2435', colorGlow: '#fbbf2430',
        robotColor: '#fbbf24', robotEye: '#fefce8', robotBg: '#451a03',
        greeting: "Hello! **Capita** here with live invoice, payment, expense, and compliance visibility. What should I break down?"
    },
    ecommerce: {
        label: 'COMMERCE', color: '#f472b6', colorDim: '#f472b660',
        colorBg: '#f472b612', colorBorder: '#f472b635', colorGlow: '#f472b630',
        robotColor: '#f472b6', robotEye: '#fdf2f8', robotBg: '#500724',
        greeting: "Sales active. **Capita** online with live invoice, payment, expense, and compliance visibility. What do you need?"
    },
};

export const DEFAULT_META = {
    label: 'AI', color: '#34d399', colorDim: '#34d39960',
    colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
    robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
    greeting: "Hey! I'm **Capita**. Ask about invoices, payments, expenses, or compliance and I'll answer from your live workspace data."
};

export const defaultActions = [
    { label: 'Customer health', icon: 'Users', query: 'Who are my top customers?', tag: 'CUSTOMERS' },
];

export const personaActions = {
    solopreneur: [
        { label: 'Customer health', icon: 'Users', query: 'Who are my top customers?', tag: 'CUSTOMERS' },
        { label: 'Invoice health', icon: 'FileText', query: 'Which invoices need attention right now?', tag: 'INVOICES' },
        { label: 'Payments', icon: 'CreditCard', query: 'What payments came in recently?', tag: 'PAYMENTS' },
        { label: 'Expenses', icon: 'Activity', query: 'What are my biggest recent expenses?', tag: 'EXPENSES' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Which compliance tasks are due this week?', tag: 'COMPLIANCE' },
    ],
    subscription: [
        { label: 'Customer insights', icon: 'Users', query: 'Who are my top customers and most at risk?', tag: 'CUSTOMERS' },
        { label: 'Invoices', icon: 'FileText', query: 'Show me my invoice pipeline and overdue invoices', tag: 'INVOICES' },
        { label: 'Payments', icon: 'CreditCard', query: 'Show me recent payment collections', tag: 'PAYMENTS' },
        { label: 'Expenses', icon: 'Activity', query: 'Show me recent expenses and top categories', tag: 'EXPENSES' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Show me open compliance work', tag: 'COMPLIANCE' },
    ],
    services_firm: [
        { label: 'Top customers', icon: 'Users', query: 'Who are my biggest regular customers?', tag: 'CUSTOMERS' },
        { label: 'Invoices', icon: 'FileText', query: 'Show me invoice performance and overdue accounts', tag: 'INVOICES' },
        { label: 'Payments', icon: 'CreditCard', query: 'Show me the latest payments and pending collections', tag: 'PAYMENTS' },
        { label: 'Expenses', icon: 'Activity', query: 'Which expenses are driving spend right now?', tag: 'EXPENSES' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Show me pending compliance tasks', tag: 'COMPLIANCE' },
    ],
    ecommerce: [
        { label: 'Customer health', icon: 'Users', query: 'Show me my top regular customers and risk status', tag: 'CUSTOMERS' },
        { label: 'Invoices', icon: 'FileText', query: 'Show me current invoice and receivable status', tag: 'INVOICES' },
        { label: 'Payments', icon: 'CreditCard', query: 'Show me recent incoming payments', tag: 'PAYMENTS' },
        { label: 'Expenses', icon: 'Activity', query: 'Show me current expense pressure', tag: 'EXPENSES' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Show me compliance deadlines and risk', tag: 'COMPLIANCE' },
    ],
};
