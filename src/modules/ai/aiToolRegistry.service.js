import aiReadModelService from './aiReadModel.service.js';

const TOOL_DEFINITIONS = {
    get_business_advisor_context: {
        id: 'get_business_advisor_context',
        label: 'Business Advisor Context',
        uiComponent: null
    },
    get_dashboard_snapshot: {
        id: 'get_dashboard_snapshot',
        label: 'Business Snapshot',
        uiComponent: null
    },
    get_recent_activity: {
        id: 'get_recent_activity',
        label: 'Recent Activity',
        uiComponent: null
    },
    get_invoice_workspace: {
        id: 'get_invoice_workspace',
        label: 'Invoice Workspace',
        uiComponent: 'ai_domain_invoices'
    },
    get_payment_workspace: {
        id: 'get_payment_workspace',
        label: 'Payment Workspace',
        uiComponent: 'ai_domain_payments'
    },
    get_expense_workspace: {
        id: 'get_expense_workspace',
        label: 'Expense Workspace',
        uiComponent: 'ai_domain_expenses'
    },
    get_compliance_workspace: {
        id: 'get_compliance_workspace',
        label: 'Compliance Workspace',
        uiComponent: 'ai_domain_compliance'
    },
    get_knowledge_base: {
        id: 'get_knowledge_base',
        label: 'Business Knowledge',
        uiComponent: null
    }
};

class AIToolRegistryService {
    getToolDefinition(toolId) {
        return TOOL_DEFINITIONS[toolId] || null;
    }

    async executeTool(toolId, context = {}, args = {}) {
        const organizationId = context.organizationId;

        switch (toolId) {
            case 'get_business_advisor_context':
                return aiReadModelService.getBusinessAdvisorContext(organizationId, args.query || context.query || '');
            case 'get_dashboard_snapshot':
                return aiReadModelService.getDashboardSnapshot(organizationId);
            case 'get_recent_activity':
                return aiReadModelService.getRecentActivity(organizationId);
            case 'get_invoice_workspace':
                return aiReadModelService.getInvoiceWorkspace(organizationId);
            case 'get_payment_workspace':
                return aiReadModelService.getPaymentWorkspace(organizationId);
            case 'get_expense_workspace':
                return aiReadModelService.getExpenseWorkspace(organizationId);
            case 'get_compliance_workspace':
                return aiReadModelService.getComplianceWorkspace(organizationId);
            case 'get_knowledge_base':
                return aiReadModelService.getBusinessKnowledge(organizationId, args.query || context.query || '');
            default:
                throw new Error(`Unknown AI tool: ${toolId}`);
        }
    }

    async planTools(query, context = {}) {
        const lowerQuery = String(query || '').toLowerCase();
        const plan = [];
        const mentionsWorkspace = ['workspace', 'dashboard', 'books', 'back office', 'operations'].some((token) => lowerQuery.includes(token));
        const asksForOverview = ['overall', 'everything', 'all areas', 'full picture', 'full overview', 'complete picture', 'summary'].some((token) => lowerQuery.includes(token));
        const includesAny = (tokens = []) => tokens.some((token) => lowerQuery.includes(token));
        const asksGeneralComplianceKnowledge = includesAny([
            'gst rules', 'tds rules', 'tax rules', 'what is gst', 'what is tds',
            'how does gst', 'how does tds', 'must be aware', 'should know',
            'for a freelancer', 'for freelancers', 'for freelancer', 'gst for freelancer',
            'gst basics', 'tds basics', 'compliance basics', 'legal basics'
        ]);
        const asksInvoiceCreationHelp = (
            includesAny(['create invoice', 'create invoices', 'new invoice', 'new invoices', 'make invoice', 'make invoices']) ||
            ((includesAny(['create', 'new', 'make']) || includesAny(['help me create', 'help me make', 'can you help me create', 'can you help me make'])) &&
                includesAny(['invoice', 'invoices']))
        );
        const asksWorkspaceComplianceStatus = includesAny([
            'my gst', 'our gst', 'my tds', 'our tds', 'my compliance', 'our compliance',
            'what is due', 'due this week', 'due this month', 'pending filing',
            'overdue filing', 'deadline', 'filing status', 'return due', 'tax deadline'
        ]);
        const asksBroadBusinessAdvice = includesAny([
            'business', 'financial', 'finance', 'performance', 'health', 'doing',
            'focus', 'priority', 'priorities', 'improve', 'improving', 'improvement',
            'optimize', 'optimise', 'best move', 'best moves', 'what should i do',
            'what should we do', 'what should i focus on', 'what should we focus on',
            'where should i focus', 'where should we focus', 'help me grow', 'growth',
            'how are we doing', 'how is the business doing', 'biggest risk', 'biggest risks'
        ]);
        const asksGeneralBusinessOrFinance = asksBroadBusinessAdvice || includesAny([
            'business finance', 'financial position', 'business position', 'profitability',
            'financial health', 'business health', 'working capital', 'money situation',
            'what is going on in the business', 'how is the company doing'
        ]);
        const asksRecentBusinessActivity = includesAny([
            'recent activity', 'recent updates', 'what happened recently', 'what changed recently',
            'latest activity', 'latest updates', 'what happened this week', 'recent business activity'
        ]);
        const pushTool = (toolId, args = {}) => {
            if (!plan.some((entry) => entry.toolId === toolId)) {
                plan.push({ toolId, args });
            }
        };

        if (includesAny([
            'runway', 'cash runway', 'safe to spend', 'safe-to-spend', 'cash flow',
            'cashflow', 'net profit', 'profit margin', 'margin', 'liquidity',
            'cash on hand', 'financial snapshot', 'business snapshot', 'revenue',
            'profitability', 'profit', 'loss', 'working capital', 'burn rate'
        ])) {
            pushTool('get_dashboard_snapshot');
        }

        if (asksRecentBusinessActivity) {
            pushTool('get_recent_activity');
        }

        if (includesAny([
            'invoice', 'invoices', 'collections', 'receivable', 'receivables',
            'overdue invoice', 'late invoice', 'billing', 'draft invoice', 'sent invoice',
            'who owes me', 'owed to me', 'unpaid invoice', 'unpaid invoices',
            'owes me money', 'owes us money',
            'invoice pipeline', 'invoice status', 'accounts receivable', 'ar aging',
            'aging report', 'ageing report', 'bill raised', 'billed customer'
        ]) && !asksInvoiceCreationHelp) {
            pushTool('get_invoice_workspace');
        }

        if (includesAny([
            'payment', 'payments', 'paid', 'collected', 'collections received',
            'receipt', 'reconcile', 'cash in', 'incoming payment',
            'money received', 'received this week', 'collections in',
            'money did we receive', 'bank receipt', 'payment received', 'customer payment',
            'cash collected', 'settlement received'
        ])) {
            pushTool('get_payment_workspace');
        }

        if (includesAny([
            'expense', 'expenses', 'spend', 'spending', 'vendor', 'vendors',
            'purchase', 'purchases', 'cost', 'costs', 'outflow',
            'supplier spend', 'supplier payment', 'burn', 'run rate',
            'money going out', 'expense categories', 'operating cost', 'opex',
            'vendor bill', 'what are we spending on'
        ])) {
            pushTool('get_expense_workspace');
        }

        if (includesAny([
            'compliance', 'gst', 'tds', 'tax', 'filing', 'return',
            'compliance task', 'compliance tasks', 'deadline', 'due date', 'regulation',
            'gst filing', 'tds filing', 'tax deadline', 'return due',
            'legal due', 'penalty risk', 'regulatory task', 'what is due this week',
            'what is due this month'
        ]) && (!asksGeneralComplianceKnowledge || asksWorkspaceComplianceStatus)) {
            pushTool('get_compliance_workspace');
        }

        if (asksForOverview) {
            pushTool('get_dashboard_snapshot');
            pushTool('get_invoice_workspace');
            pushTool('get_payment_workspace');
            pushTool('get_expense_workspace');
            pushTool('get_compliance_workspace');
        }

        if (asksGeneralBusinessOrFinance) {
            pushTool('get_business_advisor_context', { query });
        }

        if (mentionsWorkspace && plan.length === 0) {
            pushTool('get_dashboard_snapshot');
            pushTool('get_invoice_workspace');
            pushTool('get_payment_workspace');
            pushTool('get_expense_workspace');
            pushTool('get_compliance_workspace');
        }

        if (includesAny([
            'how do i', 'how to', 'policy', 'policies', 'refund', 'contact', 'support',
            'about', 'who are', 'what is the process', 'terms', 'condition', 'legal',
            'compliance policy', 'working hours', 'office', 'address', 'email', 'phone'
        ])) {
            pushTool('get_knowledge_base', { query });
        }

        // Specific insights triggers
        if (includesAny(['who owes', 'top debtor', 'top customer', 'biggest customer', 'most money'])) {
            pushTool('get_invoice_workspace');
        }

        if (includesAny(['spending on', 'top category', 'most expensive', 'biggest expense', 'where is the money going'])) {
            pushTool('get_expense_workspace');
        }

        return plan;
    }
}

export default new AIToolRegistryService();
