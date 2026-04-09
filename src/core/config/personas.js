export const PERSONA_META = {
    solopreneur: {
        label: 'CFO', color: '#34d399', colorDim: '#34d39960',
        colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
        robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
        greeting: "Hey! I'm **Capita**, your AI CFO. Ask me about your cash position, overdue invoices, recent spend, or compliance risks."
    },
    subscription: {
        label: 'CFO', color: '#818cf8', colorDim: '#818cf860',
        colorBg: '#818cf812', colorBorder: '#818cf835', colorGlow: '#818cf830',
        robotColor: '#818cf8', robotEye: '#eef2ff', robotBg: '#1e1b4b',
        greeting: "Systems nominal. **Capita CFO** is online with live invoice, payment, and expense data. What should I analyze today?"
    },
    services_firm: {
        label: 'CFO', color: '#fbbf24', colorDim: '#fbbf2460',
        colorBg: '#fbbf2412', colorBorder: '#fbbf2435', colorGlow: '#fbbf2430',
        robotColor: '#fbbf24', robotEye: '#fefce8', robotBg: '#451a03',
        greeting: "Hello! **Capita** your AI CFO is here. I have full visibility into your cash flow and receivables. What should we focus on?"
    },
    ecommerce: {
        label: 'CFO', color: '#f472b6', colorDim: '#f472b660',
        colorBg: '#f472b612', colorBorder: '#f472b635', colorGlow: '#f472b630',
        robotColor: '#f472b6', robotEye: '#fdf2f8', robotBg: '#500724',
        greeting: "Sales active. **Capita CFO** online. I can tell you if you are profitable, what your cash position is, and where you're spending too much."
    },
};

export const DEFAULT_META = {
    label: 'CFO', color: '#34d399', colorDim: '#34d39960',
    colorBg: '#34d39912', colorBorder: '#34d39935', colorGlow: '#34d39930',
    robotColor: '#34d399', robotEye: '#ecfdf5', robotBg: '#064e3b',
    greeting: "Hey! I'm **Capita**, your AI CFO. Ask about your business health, cash position, or overdue invoices."
};

export const defaultActions = [
    { label: 'Business Health', icon: 'Activity', query: 'How is the business doing?', tag: 'VERDICT' },
    { label: 'Collections', icon: 'FileText', query: 'Which invoices are overdue and need attention?', tag: 'INVOICES' },
    { label: 'Cash flow', icon: 'Banknotes', query: 'How much can I afford to spend right now?', tag: 'LIQUIDITY' },
];

export const personaActions = {
    solopreneur: [
        { label: 'Business Health', icon: 'Activity', query: 'How is my business doing?', tag: 'VERDICT' },
        { label: 'Collections', icon: 'FileText', query: 'Who owes me money right now?', tag: 'INVOICES' },
        { label: 'Check spend', icon: 'CreditCard', query: 'Can I afford to spend 50,000 this month?', tag: 'LIQUIDITY' },
        { label: 'Top Expenses', icon: 'TrendingDown', query: 'What are my biggest recent expenses?', tag: 'EXPENSE' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Do I have any overdue compliance tasks?', tag: 'RISK' },
    ],
    subscription: [
        { label: 'Cash flow', icon: 'Activity', query: 'How much cash is safe to spend?', tag: 'LIQUIDITY' },
        { label: 'Collections', icon: 'FileText', query: 'Which accounts are overdue on payment?', tag: 'INVOICES' },
        { label: 'Earnings', icon: 'TrendingUp', query: 'Are we profitable this month?', tag: 'P&L' },
        { label: 'Top Spend', icon: 'CreditCard', query: 'Where are we spending the most?', tag: 'EXPENSE' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Show me any compliance risks', tag: 'RISK' },
    ],
    services_firm: [
        { label: 'Overall Status', icon: 'Activity', query: 'What should I focus on today?', tag: 'VERDICT' },
        { label: 'Top Due', icon: 'FileText', query: 'Show me the biggest overdue invoices to chase', tag: 'INVOICES' },
        { label: 'Affordability', icon: 'Users', query: 'Can I afford to hire a new employee?', tag: 'LIQUIDITY' },
        { label: 'Profitability', icon: 'TrendingUp', query: 'Am I making a profit right now?', tag: 'P&L' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Are all my filings up to date?', tag: 'RISK' },
    ],
    ecommerce: [
        { label: 'Health Check', icon: 'Activity', query: 'How is the business health doing?', tag: 'VERDICT' },
        { label: 'Cash Position', icon: 'CreditCard', query: 'What is my current cash position?', tag: 'LIQUIDITY' },
        { label: 'Cost review', icon: 'TrendingDown', query: 'Are my operating expenses too high?', tag: 'EXPENSE' },
        { label: 'Net Profit', icon: 'TrendingUp', query: 'Are we making money this month?', tag: 'P&L' },
        { label: 'Compliance', icon: 'ShieldCheck', query: 'Do I have any pending compliance deadlines?', tag: 'RISK' },
    ],
};
