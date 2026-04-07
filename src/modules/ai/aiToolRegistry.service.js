import aiReadModelService from './aiReadModel.service.js';

const TOOL_DEFINITIONS = {
    get_business_advisor_context: {
        id: 'get_business_advisor_context',
        label: 'Business Advisor Context',
        description: 'Gets an overall AI summary of the business health. Use this for general queries like "how is my business doing", "what should I focus on", or "what is my overall health".',
        uiComponent: null
    },
    get_dashboard_snapshot: {
        id: 'get_dashboard_snapshot',
        label: 'Business Snapshot',
        description: 'Retrieves high-level summary statistics including total revenue, profit margin, number of customers, and cash safe-to-spend. Use for questions about profit, net revenue, or cash runway.',
        uiComponent: null
    },
    get_recent_activity: {
        id: 'get_recent_activity',
        label: 'Recent Activity',
        description: 'Gets the 5 most recent invoices, payments, and expenses. Use when asked "what happened recently", "recent activity", or "last week updates".',
        uiComponent: null
    },
    get_invoice_workspace: {
        id: 'get_invoice_workspace',
        label: 'Invoice Workspace',
        description: 'Retrieves outstanding invoices, overdue amounts, AR aging, draft invoices, and top debtors. Use for ANY query mentioning invoices, collections, receivables, or who owes money.',
        uiComponent: 'ai_domain_invoices'
    },
    get_payment_workspace: {
        id: 'get_payment_workspace',
        label: 'Payment Workspace',
        description: 'Retrieves completed and pending payments, recent receipts, and collections this month. Use for ANY query mentioning payments, money received, cash in, or receipts.',
        uiComponent: 'ai_domain_payments'
    },
    get_expense_workspace: {
        id: 'get_expense_workspace',
        label: 'Expense Workspace',
        description: 'Retrieves expense patterns, recent spending, top expense categories, and total outflows. Use for ANY query mentioning expenses, cost, spend, vendor bills, or outflows.',
        uiComponent: 'ai_domain_expenses'
    },
    get_compliance_workspace: {
        id: 'get_compliance_workspace',
        label: 'Compliance Workspace',
        description: 'Retrieves compliance tasks, upcoming deadlines, and overdue tax filings. Use for queries regarding due dates, pending compliance, gst filing, or overdue compliance tasks.',
        uiComponent: 'ai_domain_compliance'
    },
    get_knowledge_base: {
        id: 'get_knowledge_base',
        label: 'Business Knowledge',
        description: 'Searches the user\'s uploaded business knowledge base policies, guidelines, and rules. Use for queries asking about rules, general compliance knowledge, support policies, office hours, handling refunds, etc.',
        uiComponent: null
    }
};

class AIToolRegistryService {
    getToolDefinition(toolId) {
        return TOOL_DEFINITIONS[toolId] || null;
    }

    getAllToolDeclarations() {
        // Expose tool schema for Gemini structured output routing
        return Object.values(TOOL_DEFINITIONS).map(tool => ({
            id: tool.id,
            label: tool.label,
            description: tool.description
        }));
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
}

export default new AIToolRegistryService();
