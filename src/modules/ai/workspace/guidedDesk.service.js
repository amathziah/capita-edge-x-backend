import aiReadModelService from './readModel.service.js';

const FREELANCER_DESK_CONFIG = {
    invoices: {
        domain: 'invoices',
        label: 'Get Paid',
        shortLabel: 'Invoices',
        specialistLabel: 'Collections',
        component: 'ai_domain_invoices',
        description: 'Overdue invoices and quick actions to get paid faster.',
        promptDescription: 'View overdue invoices and create follow-ups.',
        views: [
            { id: 'overdue', label: 'Overdue' },
            { id: 'quick', label: 'Quick Create' }
        ]
    },
    payments: {
        domain: 'payments',
        label: 'Money In',
        shortLabel: 'Payments',
        specialistLabel: 'Receipts',
        component: 'ai_domain_payments',
        description: 'Recent payments received and monthly summary.',
        promptDescription: 'Check what payments have come in this month.',
        views: [
            { id: 'recent', label: 'Recent' },
            { id: 'monthly', label: 'This Month' }
        ]
    },
    expenses: {
        domain: 'expenses',
        label: 'Money Out',
        shortLabel: 'Expenses',
        specialistLabel: 'Spend',
        component: 'ai_domain_expenses',
        description: 'This month expenses and top categories.',
        promptDescription: 'See where your money is going.',
        views: [
            { id: 'overview', label: 'This Month' },
            { id: 'categories', label: 'Categories' }
        ]
    }
};

const FULL_DESK_CONFIG = {
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

let DESK_CONFIG = FREELANCER_DESK_CONFIG;

class AIGuidedDeskService {
    setBusinessType(businessType = 'solopreneur') {
        const isFreelancer = businessType === 'solopreneur';
        DESK_CONFIG = isFreelancer ? FREELANCER_DESK_CONFIG : FULL_DESK_CONFIG;
    }

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

        const promptTitle = preferredDesk
            ? `Open ${preferredDesk.label}`
            : 'What would you like to check?';
        const promptDescription = preferredDesk
            ? `${preferredDesk.promptDescription}`
            : 'Pick one to see your live numbers.';
        const text = preferredDesk
            ? `Opening ${preferredDesk.label}...`
            : 'Pick an area to see your numbers.';

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
                capabilitySummary: this._getCapabilitySummary(),
                recommendedDomain: preferredDomain,
                supportedDomains: this.getSupportedDomains(),
                choices: this.getChoices(preferredDomain),
                intent: execution.intent || null,
                domain: preferredDomain || null,
                specialistLabel: preferredDesk?.specialistLabel || 'Capita',
                provenance: []
            }
        };
    }

    _resolvePreferredDomain(query = '', primaryDomain = null) {
        if (this.isSupportedDomain(primaryDomain)) {
            return primaryDomain;
        }

        const lowerQuery = String(query || '').toLowerCase();

        if (lowerQuery.includes('invoice') || lowerQuery.includes('paid') || lowerQuery.includes('receivable') || lowerQuery.includes('collection') || lowerQuery.includes('overdue') || lowerQuery.includes('client')) {
            return 'invoices';
        }

        if (lowerQuery.includes('payment') || lowerQuery.includes('received') || lowerQuery.includes('money in') || lowerQuery.includes('cash') || lowerQuery.includes('receipt')) {
            return 'payments';
        }

        if (lowerQuery.includes('expense') || lowerQuery.includes('spent') || lowerQuery.includes('cost') || lowerQuery.includes('vendor')) {
            return 'expenses';
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

        const workspaceLoader = ({
            invoices: () => aiReadModelService.getInvoiceWorkspace(organizationId),
            payments: () => aiReadModelService.getPaymentWorkspace(organizationId),
            expenses: () => aiReadModelService.getExpenseWorkspace(organizationId),
            compliance: () => aiReadModelService.getComplianceWorkspace(organizationId),
            customers: () => aiReadModelService.getCustomerPortfolio(organizationId)
        }[desk.domain]);

        if (!workspaceLoader) {
            throw new Error(`No workspace loader configured for domain: ${desk.domain}`);
        }

        const response = await workspaceLoader();

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
            'Pick an area to focus on.',
            'See your live numbers.',
            'Take action right away.'
        ];
    }

    _getCapabilitySummary() {
        return [
            {
                id: 'capability_invoices',
                domain: 'invoices',
                label: 'Get Paid',
                summary: 'See overdue invoices and create new ones quickly.'
            },
            {
                id: 'capability_payments',
                domain: 'payments',
                label: 'Money In',
                summary: 'Check what payments you have received this month.'
            },
            {
                id: 'capability_expenses',
                domain: 'expenses',
                label: 'Money Out',
                summary: 'See where your money is going this month.'
            }
        ];
    }

    _getChoiceSteps(domain) {
        switch (domain) {
            case 'invoices':
                return [
                    'See who owes you money.',
                    'Pick someone to follow up with.'
                ];
            case 'payments':
                return [
                    'See recent payments.',
                    'Check this month total.'
                ];
            case 'expenses':
                return [
                    'See this month spending.',
                    'Check top categories.'
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
                        id: 'create_invoice',
                        type: 'navigate',
                        label: 'Create Invoice',
                        description: 'Quick create a new invoice.',
                        to: '/dashboard/invoices/new'
                    }
                ];
            case 'payments':
                return [
                    {
                        id: 'open_payments_page',
                        type: 'navigate',
                        label: 'View Payments',
                        description: 'Go to payments page.',
                        to: '/dashboard/payments'
                    }
                ];
            case 'expenses':
                return [
                    {
                        id: 'open_expenses_page',
                        type: 'navigate',
                        label: 'View Expenses',
                        description: 'Go to expenses page.',
                        to: '/dashboard/expenses'
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
                const currency = data?.currency || '';
                return {
                    title: 'Invoices',
                    summary: overdueCount > 0
                        ? `You have ${overdueCount} overdue invoices worth ${currency} ${overdueAmount.toLocaleString()}.`
                        : 'No overdue invoices. Great!',
                    steps: [
                        {
                            id: 'invoice_overdue',
                            label: overdueCount > 0 ? `${overdueCount} Overdue` : 'All Good',
                            description: overdueCount > 0
                                ? 'See who to chase.'
                                : 'No action needed.',
                            view: 'overdue'
                        },
                        {
                            id: 'invoice_create',
                            label: 'Create Invoice',
                            description: 'Quick create a new invoice.',
                            view: 'quick'
                        }
                    ],
                    selectedView
                };
            }
            case 'payments': {
                const monthCollected = Number(data?.summary?.collectedThisMonth || 0);
                const currency = data?.currency || '';
                return {
                    title: 'Money In',
                    summary: monthCollected > 0
                        ? `You've received ${currency} ${monthCollected.toLocaleString()} this month.`
                        : 'No payments recorded this month.',
                    steps: [
                        {
                            id: 'payment_recent',
                            label: 'Recent Payments',
                            description: 'See latest payments.',
                            view: 'recent'
                        },
                        {
                            id: 'payment_monthly',
                            label: 'This Month',
                            description: 'Total received.',
                            view: 'monthly'
                        }
                    ],
                    selectedView
                };
            }
            case 'expenses': {
                const spendThisMonth = Number(data?.summary?.spendThisMonth || 0);
                const currency = data?.currency || '';
                return {
                    title: 'Money Out',
                    summary: spendThisMonth > 0
                        ? `You've spent ${currency} ${spendThisMonth.toLocaleString()} this month.`
                        : 'No expenses recorded.',
                    steps: [
                        {
                            id: 'expense_monthly',
                            label: 'This Month',
                            description: 'Total spent.',
                            view: 'overview'
                        },
                        {
                            id: 'expense_categories',
                            label: 'Categories',
                            description: 'Top spending categories.',
                            view: 'categories'
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
