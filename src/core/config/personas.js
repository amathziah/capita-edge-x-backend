export const PERSONA_META = {
    solopreneur: {
        label: 'SOLO', color: '#34d399', colorDim: '#34d39960',
        colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
        robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
        greeting: "Hey! I'm **Capita** — your AI CFO. I've analyzed your cash flow, tax reserves, and client reliability. What should we tackle first?"
    },
    subscription: {
        label: 'SaaS', color: '#818cf8', colorDim: '#818cf860',
        colorBg: '#818cf812', colorBorder: '#818cf835', colorGlow: '#818cf830',
        robotColor: '#818cf8', robotEye: '#eef2ff', robotBg: '#1e1b4b',
        greeting: "Systems nominal. **Capita** online — tracking MRR, churn, and subscription health in real time. Ready for your metrics?"
    },
    services_firm: {
        label: 'AGENCY', color: '#fbbf24', colorDim: '#fbbf2460',
        colorBg: '#fbbf2412', colorBorder: '#fbbf2435', colorGlow: '#fbbf2430',
        robotColor: '#fbbf24', robotEye: '#fefce8', robotBg: '#451a03',
        greeting: "Hello! **Capita** here — monitoring retainers, billable hours, and project margins. How can I help today?"
    },
    ecommerce: {
        label: 'COMMERCE', color: '#f472b6', colorDim: '#f472b660',
        colorBg: '#f472b612', colorBorder: '#f472b635', colorGlow: '#f472b630',
        robotColor: '#f472b6', robotEye: '#fdf2f8', robotBg: '#500724',
        greeting: "Sales active. **Capita** online — tracking revenue, orders, and collections. What do you need?"
    },
};

export const DEFAULT_META = {
    label: 'AI', color: '#34d399', colorDim: '#34d39960',
    colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
    robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
    greeting: "Hey! I'm **Capita**, your financial copilot. Ask about revenue, invoices, cash flow, or anything about your business. I'm ready."
};

export const defaultActions = [
    { label: 'Revenue today', icon: 'TrendingUp', query: 'What is my total revenue?', tag: 'FINANCE' },
    { label: 'Recent expenses', icon: 'CreditCard', query: 'Show me my last 5 expenses', tag: 'SPEND' },
    { label: 'Draft invoice', icon: 'FileText', query: 'Help me create a new invoice', tag: 'ACTION' },
    { label: 'Business health', icon: 'Zap', query: 'Give me a business health summary', tag: 'OVERVIEW' },
    { label: 'Top customers', icon: 'Users', query: 'Who are my top customers?', tag: 'CRM' },
    { label: 'Net cash flow', icon: 'Activity', query: 'What is my current net cash flow?', tag: 'CASH' },
];

export const personaActions = {
    solopreneur: [
        { label: 'Safe to Spend', icon: 'Activity', query: 'How much cash is safe to spend after taxes and risk?', tag: 'LIQUIDITY' },
        { label: 'Tax Reserves', icon: 'Zap', query: 'Show me my GST and Income Tax reserve breakdown', tag: 'TAX' },
        { label: 'Client Trust', icon: 'Users', query: 'Who are my most reliable clients and who is late?', tag: 'CRM' },
        { label: 'Revenue Risk', icon: 'AlertTriangle', query: 'Am I too dependent on a single client for revenue?', tag: 'RISK' },
    ],
    subscription: [
        { label: 'Check MRR', icon: 'TrendingUp', query: 'What is my current Monthly Recurring Revenue?', tag: 'MRR' },
        { label: 'Churn report', icon: 'Users', query: 'Analyze my customer churn', tag: 'CHURN' },
        { label: 'Growth rate', icon: 'Activity', query: 'What is my revenue growth month-over-month?', tag: 'GROWTH' },
        { label: 'LTV analysis', icon: 'Zap', query: 'What is the average customer lifetime value?', tag: 'LTV' },
    ],
    services_firm: [
        { label: 'Project profit', icon: 'TrendingUp', query: 'Which projects are most profitable?', tag: 'P&L' },
        { label: 'Unbilled work', icon: 'Clock', query: 'Show me all unbilled hours', tag: 'HOURS' },
        { label: 'Retainer risks', icon: 'AlertTriangle', query: 'Are any client retainers nearly empty?', tag: 'RISK' },
        { label: 'Burn rate', icon: 'Activity', query: 'What is our current monthly burn rate?', tag: 'BURN' },
    ],
    ecommerce: [
        { label: 'Revenue today', icon: 'TrendingUp', query: 'What is my total revenue today?', tag: 'REVENUE' },
        { label: 'Overdue orders', icon: 'AlertTriangle', query: 'Show me all overdue invoices', tag: 'RISK' },
        { label: 'Top customers', icon: 'Users', query: 'Who are my top customers by revenue?', tag: 'CRM' },
        { label: 'Cash flow', icon: 'Activity', query: 'What is my current net cash flow?', tag: 'CASH' },
    ],
};
