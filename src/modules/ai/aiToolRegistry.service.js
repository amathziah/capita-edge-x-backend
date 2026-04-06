import analyticsService from '../analytics/analytics.service.js';
import aiReadModelService from './aiReadModel.service.js';

const TOOL_DEFINITIONS = {
    get_dashboard_snapshot: {
        id: 'get_dashboard_snapshot',
        label: 'Dashboard Snapshot',
        uiComponent: 'get_financial_summary'
    },
    get_safe_to_spend: {
        id: 'get_safe_to_spend',
        label: 'Safe To Spend',
        uiComponent: 'get_financial_summary'
    },
    get_overdue_receivables: {
        id: 'get_overdue_receivables',
        label: 'Overdue Receivables',
        uiComponent: 'get_overdue_invoices'
    },
    get_recent_activity: {
        id: 'get_recent_activity',
        label: 'Recent Activity',
        uiComponent: 'get_recent_transactions'
    },
    get_customer_portfolio: {
        id: 'get_customer_portfolio',
        label: 'Customer Portfolio',
        uiComponent: 'get_customer_insights'
    },
    get_customer_detail: {
        id: 'get_customer_detail',
        label: 'Customer Detail',
        uiComponent: 'get_customer_details'
    },
    get_cash_flow: {
        id: 'get_cash_flow',
        label: 'Cash Flow',
        uiComponent: null
    },
    get_revenue_trends: {
        id: 'get_revenue_trends',
        label: 'Revenue Trends',
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
            case 'get_dashboard_snapshot':
                return aiReadModelService.getDashboardSnapshot(organizationId);
            case 'get_safe_to_spend': {
                const snapshot = await aiReadModelService.getDashboardSnapshot(organizationId);
                return {
                    data: {
                        safeToSpend: snapshot.data.safeToSpend,
                        currency: snapshot.data.currency
                    },
                    meta: {
                        ...snapshot.meta,
                        source: 'analytics.getSafeToSpend'
                    }
                };
            }
            case 'get_overdue_receivables':
                return aiReadModelService.getOverdueReceivables(organizationId);
            case 'get_recent_activity':
                return aiReadModelService.getRecentActivity(organizationId);
            case 'get_customer_portfolio':
                return aiReadModelService.getCustomerPortfolio(organizationId);
            case 'get_customer_detail':
                return aiReadModelService.getCustomerDetail(organizationId, args.customer_id);
            case 'get_cash_flow': {
                const [{ currency }, cashFlow] = await Promise.all([
                    aiReadModelService.getOrganizationContext(organizationId),
                    analyticsService.getCashFlowAnalysis(organizationId)
                ]);
                return {
                    data: { ...cashFlow, currency },
                    meta: {
                        source: 'analytics.getCashFlowAnalysis',
                        generated_at: new Date().toISOString(),
                        organization_id: organizationId,
                        currency
                    }
                };
            }
            case 'get_revenue_trends': {
                const [{ currency }, trends] = await Promise.all([
                    aiReadModelService.getOrganizationContext(organizationId),
                    analyticsService.getRevenueTrends(organizationId, args.period || 'monthly')
                ]);
                return {
                    data: { trends, currency, period: args.period || 'monthly' },
                    meta: {
                        source: 'analytics.getRevenueTrends',
                        generated_at: new Date().toISOString(),
                        organization_id: organizationId,
                        currency
                    }
                };
            }
            default:
                throw new Error(`Unknown AI tool: ${toolId}`);
        }
    }

    async planTools(query, context = {}) {
        const lowerQuery = String(query || '').toLowerCase();
        const plan = [];

        const pushTool = (toolId, args = {}) => {
            if (!plan.some((entry) => entry.toolId === toolId)) {
                plan.push({ toolId, args });
            }
        };

        if ([
            'summary', 'overview', 'revenue', 'profit', 'margin', 'dashboard',
            'safe to spend', 'liquidity', 'cash position', 'business health'
        ].some((token) => lowerQuery.includes(token))) {
            pushTool('get_dashboard_snapshot');
        }

        if ([
            'cash flow', 'cashflow', 'burn', 'runway'
        ].some((token) => lowerQuery.includes(token))) {
            pushTool('get_cash_flow');
            pushTool('get_dashboard_snapshot');
        }

        if ([
            'who owes me', 'overdue', 'late payment', 'late invoice', 'collections',
            'receivable', 'ageing', 'aging'
        ].some((token) => lowerQuery.includes(token))) {
            pushTool('get_overdue_receivables');
        }

        if ([
            'recent', 'latest', 'last 5', 'recent activity', 'recent transactions',
            'latest payments', 'latest expenses'
        ].some((token) => lowerQuery.includes(token))) {
            pushTool('get_recent_activity');
        }

        const mentionsCustomers = [
            'customer', 'customers', 'client', 'clients', 'portfolio', 'top client', 'top customer'
        ].some((token) => lowerQuery.includes(token));

        if (mentionsCustomers) {
            pushTool('get_customer_portfolio');
        }

        if (['trend', 'trends', 'growth', 'month-over-month', 'mom'].some((token) => lowerQuery.includes(token))) {
            pushTool('get_revenue_trends', { period: 'monthly' });
        }

        if (mentionsCustomers) {
            const portfolio = await aiReadModelService.getCustomerPortfolio(context.organizationId);
            const customers = portfolio.data?.customers || [];
            const match = customers.find((customer) => {
                const name = String(customer.name || '').toLowerCase();
                return name && lowerQuery.includes(name);
            });

            if (match) {
                pushTool('get_customer_detail', { customer_id: match.id });
            }
        }

        return plan;
    }
}

export default new AIToolRegistryService();
