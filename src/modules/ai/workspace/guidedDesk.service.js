import aiReadModelService from './readModel.service.js';

const DESK_CONFIG = {
    invoices: {
        domain: 'invoices',
        label: 'Invoice Workspace',
        shortLabel: 'Invoices',
        specialistLabel: 'Collections Desk',
        component: 'ai_domain_invoices',
        description: 'Overdue queue, outstanding receivables, recent invoices, and top debtors.',
        promptDescription: 'Use the invoice workspace to review receivables, identify risk, and decide who to follow up with first.',
        views: [
            { id: 'overview', label: 'Overview' },
            { id: 'overdue', label: 'Overdue Queue' },
            { id: 'recent', label: 'Recent Invoices' },
            { id: 'debtors', label: 'Top Debtors' }
        ]
    },
    payments: {
        domain: 'payments',
        label: 'Payments Workspace',
        shortLabel: 'Payments',
        specialistLabel: 'Payments Desk',
        component: 'ai_domain_payments',
        description: 'Recent receipts, monthly collections, pending items, and cash-in visibility.',
        promptDescription: 'Use the payments workspace to confirm what came in, what is still pending, and whether collections are improving.',
        views: [
            { id: 'overview', label: 'Overview' },
            { id: 'recent', label: 'Recent Payments' },
            { id: 'monthly', label: 'This Month' },
            { id: 'pending', label: 'Pending Items' }
        ]
    },
    expenses: {
        domain: 'expenses',
        label: 'Expenses Workspace',
        shortLabel: 'Expenses',
        specialistLabel: 'Spend Desk',
        component: 'ai_domain_expenses',
        description: 'Spend overview, recent expenses, top categories, and cost pressure.',
        promptDescription: 'Use the expenses workspace to understand where money is going and which categories need tighter control.',
        views: [
            { id: 'overview', label: 'Overview' },
            { id: 'recent', label: 'Recent Expenses' },
            { id: 'categories', label: 'Top Categories' },
            { id: 'monthly', label: 'This Month' }
        ]
    },
    compliance: {
        domain: 'compliance',
        label: 'Compliance Workspace',
        shortLabel: 'Compliance',
        specialistLabel: 'Compliance Desk',
        component: 'ai_domain_compliance',
        description: 'Urgent tasks, due dates, overdue filings, and compliance workload.',
        promptDescription: 'Use the compliance workspace to see what is due, what is overdue, and what needs attention first.',
        views: [
            { id: 'overview', label: 'Overview' },
            { id: 'urgent', label: 'Urgent Tasks' },
            { id: 'due_this_week', label: 'Due This Week' },
            { id: 'recent', label: 'Recent Tasks' }
        ]
    },
    customers: {
        domain: 'customers',
        label: 'Customer Intelligence',
        shortLabel: 'Customers',
        specialistLabel: 'Customer Desk',
        component: 'ai_domain_customers',
        description: 'Customer revenue, churn risk, and top client insights.',
        promptDescription: 'Use the customer intelligence workspace to understand your client health and identify risks.',
        views: [
            { id: 'overview', label: 'Overview' },
            { id: 'top_clients', label: 'Top Clients' },
            { id: 'risk_analysis', label: 'Risk Analysis' }
        ]
    }
};

class AIGuidedDeskService {
    getSupportedDomains() {
        return Object.keys(DESK_CONFIG);
    }

    isSupportedDomain(domain = '') {
        return Boolean(DESK_CONFIG[String(domain || '').toLowerCase()]);
    }

    getDesk(domain = '') {
        return DESK_CONFIG[String(domain || '').toLowerCase()] || null;
    }

    getChoices(preferredDomain = null) {
        const supportedDomains = this.getSupportedDomains();
        const ordered = preferredDomain && supportedDomains.includes(preferredDomain)
            ? [preferredDomain, ...supportedDomains.filter((domain) => domain !== preferredDomain)]
            : supportedDomains;

        return ordered.map((domain) => {
            const desk = this.getDesk(domain);
            return {
                id: domain,
                domain,
                label: desk.label,
                shortLabel: desk.shortLabel,
                specialistLabel: desk.specialistLabel,
                component: desk.component,
                description: desk.description,
                recommended: domain === preferredDomain,
                defaultView: desk.views[0]?.id || 'overview',
                views: desk.views,
                steps: this._getChoiceSteps(domain),
                actions: this._getDomainActions(domain)
            };
        });
    }

    buildGuidedChoiceResponse(query = '', execution = {}) {
        const preferredDomain = this._resolvePreferredDomain(query, execution.primaryDomain);
        const preferredDesk = preferredDomain ? this.getDesk(preferredDomain) : null;
        const specialistLabel = preferredDesk?.specialistLabel || 'Front Desk';
        const showCapabilitySummary = this._shouldShowCapabilitySummary(query, execution.intent, preferredDomain);

        const promptTitle = preferredDesk
            ? `Open ${preferredDesk.label}`
            : (showCapabilitySummary ? 'What Capita Can Do' : 'Choose A Workspace');
        const promptDescription = preferredDesk
            ? `${preferredDesk.promptDescription} Choose a workspace to continue with live backend data.`
            : (
                showCapabilitySummary
                    ? 'Capita works through dedicated finance desks with live backend data. Pick the area you want to inspect or act on.'
                    : 'Capita handles invoices, payments, expenses, compliance, and customers here. Pick one to continue.'
            );
        const text = preferredDesk
            ? `I can handle this through the ${preferredDesk.shortLabel.toLowerCase()} workspace with live backend data. Choose how you want to analyze it.`
            : (
                showCapabilitySummary
                    ? 'I handle five things here: invoices, payments, expenses, compliance, and customer intelligence.'
                    : 'I can help through invoices, payments, expenses, compliance, or customers.'
            );

        return {
            text,
            action: null,
            provider: 'system:guided_router',
            usage: null,
            data: {
                type: 'guided_choice',
                interactionMode: 'guided_choice',
                promptTitle,
                promptDescription,
                promptSteps: preferredDomain ? this._getChoiceSteps(preferredDomain) : this._getFrontDeskSteps(),
                capabilitySummary: showCapabilitySummary ? this._getCapabilitySummary() : [],
                recommendedDomain: preferredDomain,
                supportedDomains: this.getSupportedDomains(),
                choices: this.getChoices(preferredDomain),
                intent: execution.intent || null,
                domain: preferredDomain || null,
                specialistLabel,
                provenance: []
            }
        };
    }

    _resolvePreferredDomain(query = '', primaryDomain = null) {
        if (this.isSupportedDomain(primaryDomain)) {
            return primaryDomain;
        }

        const lowerQuery = String(query || '').toLowerCase();
        const includesAny = (tokens = []) => tokens.some((token) => lowerQuery.includes(token));

        if (includesAny(['invoice', 'invoices', 'receivable', 'receivables', 'collections', 'billing'])) {
            return 'invoices';
        }

        if (includesAny(['payment', 'payments', 'receipt', 'receipts', 'cash in', 'collections received'])) {
            return 'payments';
        }

        if (includesAny(['expense', 'expenses', 'spend', 'spending', 'cost', 'vendor'])) {
            return 'expenses';
        }

        if (includesAny(['compliance', 'gst', 'tds', 'tax', 'filing', 'deadline', 'return'])) {
            return 'compliance';
        }

        if (includesAny(['customer', 'customers', 'client', 'clients', 'churn', 'engagement', 'relationship'])) {
            return 'customers';
        }

        return null;
    }

    _shouldShowCapabilitySummary(query = '', intent = null, preferredDomain = null) {
        if (preferredDomain) return false;

        const lowerQuery = String(query || '').toLowerCase();
        const includesAny = (tokens = []) => tokens.some((token) => lowerQuery.includes(token));

        if (intent === 'conversational' && includesAny([
            'what can you do',
            'things you can do',
            'capabilities',
            'how can you help',
            'what do you do here',
            'help me here'
        ])) {
            return true;
        }

        return includesAny([
            'what can you do',
            'things you can do',
            'capabilities',
            'how can you help',
            'what do you do here'
        ]);
    }

    async getWorkspace(domain = '', organizationId, view = 'overview') {
        const desk = this.getDesk(domain);
        if (!desk) {
            throw new Error(`Unsupported AI workspace domain: ${domain}`);
        }

        const response = await ({
            invoices: () => aiReadModelService.getInvoiceWorkspace(organizationId),
            payments: () => aiReadModelService.getPaymentWorkspace(organizationId),
            expenses: () => aiReadModelService.getExpenseWorkspace(organizationId),
            compliance: () => aiReadModelService.getComplianceWorkspace(organizationId),
            customers: () => aiReadModelService.getCustomerPortfolio(organizationId)
        }[desk.domain])();

        return {
            component: desk.component,
            domain: desk.domain,
            label: desk.label,
            specialistLabel: desk.specialistLabel,
            selectedView: view,
            availableViews: desk.views,
            data: {
                ...(response?.data || {}),
                selectedView: view,
                availableViews: desk.views,
                workspaceLabel: desk.label,
                workspaceDomain: desk.domain,
                specialistLabel: desk.specialistLabel,
                guidance: this._buildWorkspaceGuidance(desk.domain, response?.data || {}, view),
                actions: this._getDomainActions(desk.domain)
            },
            meta: {
                ...(response?.meta || {}),
                component: desk.component,
                domain: desk.domain,
                selected_view: view,
                label: desk.label
            }
        };
    }

    _getFrontDeskSteps() {
        return [
            'Choose the finance area you want to inspect.',
            'Open the live workspace to review backend data.',
            'Use the guided views to analyze the issue step by step.'
        ];
    }

    _getCapabilitySummary() {
        return [
            {
                id: 'capability_invoices',
                domain: 'invoices',
                label: 'Invoices',
                summary: 'Review overdue invoices, outstanding amounts, top debtors, and open the full invoices table or create a new invoice.'
            },
            {
                id: 'capability_payments',
                domain: 'payments',
                label: 'Payments',
                summary: 'Check recent receipts, this month collections, pending items, and open the full payments page.'
            },
            {
                id: 'capability_expenses',
                domain: 'expenses',
                label: 'Expenses',
                summary: 'Analyze spend, recent expenses, top categories, and open the full expenses page.'
            },
            {
                id: 'capability_compliance',
                domain: 'compliance',
                label: 'Compliance',
                summary: 'Track urgent tasks, due-this-week items, overdue work, and open the full compliance page.'
            },
            {
                id: 'capability_customers',
                domain: 'customers',
                label: 'Customers',
                summary: 'Identify top clients, revenue trends, and detect churn risks early with automated scoring.'
            }
        ];
    }

    _getChoiceSteps(domain) {
        switch (domain) {
            case 'invoices':
                return [
                    'Check the overdue queue first.',
                    'Identify the highest-value debtors.',
                    'Decide who to follow up with first.'
                ];
            case 'payments':
                return [
                    'Review the most recent receipts.',
                    'Compare collections for this month.',
                    'Check if any payments are still pending.'
                ];
            case 'expenses':
                return [
                    'Review current month spend.',
                    'Inspect the top cost categories.',
                    'Look for unusual or avoidable outflows.'
                ];
            case 'compliance':
                return [
                    'Check overdue tasks first.',
                    'Review what is due this week.',
                    'Use the list to prioritize filings and closures.'
                ];
            case 'customers':
                return [
                    'Review your highest-value clients.',
                    'Identify clients with elevated churn risk.',
                    'Decide on retention strategies for key accounts.'
                ];
            default:
                return [];
        }
    }

    _getDomainActions(domain) {
        switch (domain) {
            case 'invoices':
                return [
                    {
                        id: 'open_invoice_table',
                        type: 'navigate',
                        label: 'Open Full Invoice Table',
                        description: 'Go to the full invoices screen with the complete table and filters.',
                        to: '/dashboard/invoices'
                    },
                    {
                        id: 'create_invoice',
                        type: 'navigate',
                        label: 'Create Invoice',
                        description: 'Open the dedicated invoice creation screen.',
                        to: '/dashboard/invoices/new'
                    }
                ];
            case 'payments':
                return [
                    {
                        id: 'open_payments_page',
                        type: 'navigate',
                        label: 'Open Payments Page',
                        description: 'Go to the full payments screen.',
                        to: '/dashboard/payments'
                    }
                ];
            case 'expenses':
                return [
                    {
                        id: 'open_expenses_page',
                        type: 'navigate',
                        label: 'Open Expenses Page',
                        description: 'Go to the full expenses screen.',
                        to: '/dashboard/expenses'
                    }
                ];
            case 'compliance':
                return [
                    {
                        id: 'open_compliance_page',
                        type: 'navigate',
                        label: 'Open Compliance Page',
                        description: 'Go to the full compliance screen.',
                        to: '/dashboard/compliance'
                    }
                ];
            case 'customers':
                return [
                    {
                        id: 'open_customers_page',
                        type: 'navigate',
                        label: 'Open Customers Page',
                        description: 'Go to the full customers table and detail screen.',
                        to: '/dashboard/customers'
                    }
                ];
            default:
                return [];
        }
    }

    _buildWorkspaceGuidance(domain, data = {}, selectedView = 'overview') {
        switch (domain) {
            case 'invoices': {
                const overdueCount = Number(data?.summary?.overdueCount || 0);
                const overdueAmount = Number(data?.summary?.overdueAmount || 0);
                const topDebtor = Array.isArray(data?.topDebtors) ? data.topDebtors[0] : null;
                return {
                    title: 'How To Analyze Invoices',
                    summary: overdueCount > 0
                        ? `Start with the overdue queue. There are ${overdueCount} overdue invoices totaling ${overdueAmount.toLocaleString()}.`
                        : 'Start with the recent invoice feed, then check debtor concentration and outstanding balances.',
                    steps: [
                        {
                            id: 'invoice_overdue',
                            label: overdueCount > 0 ? `Review ${overdueCount} overdue invoices` : 'Review overdue queue',
                            description: overdueCount > 0
                                ? 'Use the overdue view to decide which customers need collection follow-up first.'
                                : 'Use this view to check whether any receivables have slipped into overdue status.',
                            view: 'overdue'
                        },
                        {
                            id: 'invoice_recent',
                            label: 'Check recent invoice activity',
                            description: 'Use the recent view to verify draft, sent, and recently raised invoices.',
                            view: 'recent'
                        },
                        {
                            id: 'invoice_debtors',
                            label: topDebtor?.name ? `Inspect ${topDebtor.name}` : 'Inspect top debtors',
                            description: 'Use the debtor view to see where receivable concentration is building up.',
                            view: 'debtors'
                        }
                    ],
                    selectedView
                };
            }
            case 'payments': {
                const monthCollected = Number(data?.summary?.collectedThisMonth || 0);
                const pendingCount = Number(data?.summary?.pendingCount || 0);
                return {
                    title: 'How To Analyze Payments',
                    summary: monthCollected > 0
                        ? `Start with this month. Collections recorded so far are ${monthCollected.toLocaleString()}.`
                        : 'Start with recent receipts, then check whether anything is still pending.',
                    steps: [
                        {
                            id: 'payment_recent',
                            label: 'Review recent receipts',
                            description: 'Use the recent view to verify incoming payments and spot missing references.',
                            view: 'recent'
                        },
                        {
                            id: 'payment_monthly',
                            label: 'Check this month collection trend',
                            description: 'Use the monthly view to understand current cash-in performance.',
                            view: 'monthly'
                        },
                        {
                            id: 'payment_pending',
                            label: pendingCount > 0 ? `Review ${pendingCount} pending items` : 'Review pending items',
                            description: 'Use the pending view to isolate payments that are not fully settled yet.',
                            view: 'pending'
                        }
                    ],
                    selectedView
                };
            }
            case 'expenses': {
                const spendThisMonth = Number(data?.summary?.spendThisMonth || 0);
                const topCategory = Array.isArray(data?.topCategories) ? data.topCategories[0] : null;
                return {
                    title: 'How To Analyze Expenses',
                    summary: spendThisMonth > 0
                        ? `Start with current month spend. Recorded outflow so far is ${spendThisMonth.toLocaleString()}.`
                        : 'Start with recent expenses, then inspect category concentration.',
                    steps: [
                        {
                            id: 'expense_monthly',
                            label: 'Review current month spend',
                            description: 'Use the monthly view to understand present cost pressure.',
                            view: 'monthly'
                        },
                        {
                            id: 'expense_recent',
                            label: 'Inspect recent expense entries',
                            description: 'Use the recent view to verify the latest expense records and vendor entries.',
                            view: 'recent'
                        },
                        {
                            id: 'expense_categories',
                            label: topCategory?.category ? `Inspect ${topCategory.category}` : 'Inspect top categories',
                            description: 'Use the categories view to find where most of the money is going.',
                            view: 'categories'
                        }
                    ],
                    selectedView
                };
            }
            case 'compliance': {
                const overdueCount = Number(data?.summary?.overdueCount || 0);
                const dueThisWeekCount = Number(data?.summary?.dueThisWeekCount || 0);
                return {
                    title: 'How To Analyze Compliance',
                    summary: overdueCount > 0
                        ? `Start with overdue tasks. There are ${overdueCount} items already past due.`
                        : `Start with what is due this week. There are ${dueThisWeekCount} upcoming items to review.`,
                    steps: [
                        {
                            id: 'compliance_urgent',
                            label: overdueCount > 0 ? `Resolve ${overdueCount} overdue items` : 'Review urgent tasks',
                            description: 'Use the urgent view to focus on the most time-sensitive tasks first.',
                            view: 'urgent'
                        },
                        {
                            id: 'compliance_week',
                            label: dueThisWeekCount > 0 ? `Check ${dueThisWeekCount} tasks due this week` : 'Check due this week',
                            description: 'Use this view to plan the immediate filing and submission workload.',
                            view: 'due_this_week'
                        },
                        {
                            id: 'compliance_recent',
                            label: 'Review recent task updates',
                            description: 'Use the recent view to inspect the latest status changes and closures.',
                            view: 'recent'
                        }
                    ],
                    selectedView
                };
            }
            case 'customers': {
                const customerData = Array.isArray(data?.customers) ? data.customers : [];
                const customerCount = customerData.length;
                const riskyCount = customerData.filter(c => (c.churn_risk_score || 0) > 50).length;
                return {
                    title: 'How To Analyze Customers',
                    summary: riskyCount > 0
                        ? `You have ${customerCount} total customers. ${riskyCount} show high churn risk and need attention.`
                        : `Review your ${customerCount} customers to identify top growth opportunities.`,
                    steps: [
                        {
                            id: 'customer_top',
                            label: 'Identify top revenue clients',
                            description: 'Focus on your most loyal and high-spending customers.',
                            view: 'top_clients'
                        },
                        {
                            id: 'customer_risk',
                            label: riskyCount > 0 ? `Review ${riskyCount} risky clients` : 'Identify churn risk',
                            description: 'Spot warning signs before clients churn by looking at engagement scores.',
                            view: 'risk_analysis'
                        }
                    ],
                    selectedView
                };
            }
            default:
                return null;
        }
    }
}

export default new AIGuidedDeskService();
