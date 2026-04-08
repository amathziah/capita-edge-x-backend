const INTENTS = {
    conversational: {
        id: 'conversational',
        label: 'Conversational',
        domain: 'general',
        specialistLabel: 'Front Desk'
    },
    business_health: {
        id: 'business_health',
        label: 'Business Health',
        domain: 'finance',
        specialistLabel: 'Finance Lead'
    },
    cash_flow: {
        id: 'cash_flow',
        label: 'Cash Flow',
        domain: 'finance',
        specialistLabel: 'Liquidity Desk'
    },
    payments_recent: {
        id: 'payments_recent',
        label: 'Recent Payments',
        domain: 'payments',
        specialistLabel: 'Payments Desk'
    },
    invoices_attention: {
        id: 'invoices_attention',
        label: 'Invoice Attention',
        domain: 'invoices',
        specialistLabel: 'Collections Desk'
    },
    expenses_spend: {
        id: 'expenses_spend',
        label: 'Expenses Spend',
        domain: 'expenses',
        specialistLabel: 'Spend Desk'
    },
    compliance_status: {
        id: 'compliance_status',
        label: 'Compliance Status',
        domain: 'compliance',
        specialistLabel: 'Compliance Desk'
    },
    compliance_knowledge: {
        id: 'compliance_knowledge',
        label: 'Compliance Knowledge',
        domain: 'compliance',
        specialistLabel: 'Compliance Desk'
    },
    customer_insights: {
        id: 'customer_insights',
        label: 'Customer Insights',
        domain: 'customers',
        specialistLabel: 'Customer Desk'
    },
    action_request: {
        id: 'action_request',
        label: 'Action Request',
        domain: 'actions',
        specialistLabel: 'Operations Desk'
    },
    general_advice: {
        id: 'general_advice',
        label: 'General Advice',
        domain: 'finance',
        specialistLabel: 'Finance Guide'
    }
};

class AIIntentService {
    detect(query = '') {
        const text = String(query || '').toLowerCase();
        const includesAny = (tokens = []) => tokens.some((token) => text.includes(token));
        const matchesAny = (patterns = []) => patterns.some((pattern) => pattern.test(text));
        const isHowAreWeDoing = text.includes('how are we doing') || (text.includes('how are we') && text.includes('doing'));
        const isConversational = matchesAny([
            /\bhi\b/,
            /\bhello\b/,
            /\bhey\b/,
            /\bwho are you\b/,
            /\bwhat can you do\b/,
            /\bthings you can do\b/,
            /\bhow can you help\b/,
            /\bcan you help\b/,
            /\bgood morning\b/,
            /\bgood evening\b/,
            /\bgood afternoon\b/,
            /\bgood night\b/,
            /\bthank you\b/,
            /\bthanks\b/,
            /\bhow are you\b/,
            /\bhow are u\b/,
            /\bhow are you doing\b/,
            /\bhow are you doing these days\b/
        ]);

        if (isHowAreWeDoing || includesAny(['how are you doing', 'how is the business doing', 'business health', 'overall', 'full picture', 'summary'])) {
            return INTENTS.business_health.id;
        }

        if (isConversational && !includesAny([
            'invoice', 'payment', 'expense', 'cash flow', 'cashflow', 'gst', 'tds',
            'compliance', 'overdue', 'runway', 'tax', 'revenue', 'profit', 'margin'
        ])) {
            return INTENTS.conversational.id;
        }

        if (includesAny(['safe to spend', 'cash flow', 'cashflow', 'runway', 'liquidity', 'cash on hand', 'burn rate'])) {
            return INTENTS.cash_flow.id;
        }

        if (includesAny([
            'recent payment', 'recent payments', 'payments came in', 'payments received',
            'cash came in', 'collections came in', 'received recently',
            'payment', 'payments', 'receipt', 'receipts'
        ])) {
            return INTENTS.payments_recent.id;
        }

        if (includesAny([
            'overdue invoice', 'overdue invoices', 'which invoices need attention',
            'invoice attention', 'invoice status', 'who owes me', 'collections',
            'invoice', 'invoices', 'receivable', 'receivables', 'billing', 'billed'
        ])) {
            return INTENTS.invoices_attention.id;
        }

        if (includesAny(['expense', 'expenses', 'spend', 'spending', 'burn', 'operating cost', 'vendor bill', 'what are we spending on'])) {
            return INTENTS.expenses_spend.id;
        }

        if (includesAny(['gst rules', 'tds rules', 'tax rules', 'gst filing', 'tds filing', 'compliance', 'due this week', 'due this month', 'deadline'])) {
            return includesAny(['what are the gst rules', 'gst rules i must be aware of', 'gst basics', 'what is gst', 'what is tds'])
                ? INTENTS.compliance_knowledge.id
                : INTENTS.compliance_status.id;
        }

        if (includesAny(['customer', 'customers', 'client', 'clients', 'top customer', 'who owes'])) {
            return INTENTS.customer_insights.id;
        }

        // action_request only fires for pure navigation commands (no finance data words present)
        // Finance queries with navigation verbs are handled by the domain intents above.
        if (matchesAny([
            /\bopen\s+(the\s+)?(invoice|payment|expense|compliance|dashboard)\s*(page|workspace|screen|tab)?\b/,
            /\bgo\s+to\s+(invoice|payment|expense|compliance|dashboard)\b/,
            /\bnavigate\s+to\s+(invoice|payment|expense|compliance|dashboard)\b/,
            /\bshow\s+(me\s+)?the\s+(invoice|payment|expense|compliance)\s*(workspace|page|screen)\b/,
            /\bcreate\s+(a\s+)?(new\s+)?(invoice|customer|expense)\b/,
            /\bsend\s+(an?\s+)?invoice\b/,
            /\badd\s+(a\s+)?(new\s+)?(customer|expense|payment)\b/,
            /\bshow\s+me\s+my\s+workspaces?\b/,
            /\bhelp\s+me\s+navigate\b/,
            /\bexplore\s+(the\s+)?system\b/
        ])) {
            return INTENTS.action_request.id;
        }

        return INTENTS.general_advice.id;
    }

    getMetadata(intentId) {
        return Object.values(INTENTS).find((entry) => entry.id === intentId) || INTENTS.general_advice;
    }

    isActionIntent(intentId) {
        return intentId === INTENTS.action_request.id;
    }

    isConversationalIntent(intentId) {
        return intentId === INTENTS.conversational.id;
    }

    getToolsForIntent(intentId) {
        const mapping = {
            business_health: ['get_business_advisor_context'],
            cash_flow: ['get_dashboard_snapshot'],
            payments_recent: ['get_payment_workspace'],
            invoices_attention: ['get_invoice_workspace'],
            expenses_spend: ['get_expense_workspace'],
            compliance_status: ['get_compliance_workspace'],
            customer_insights: ['get_customer_insights']
        };
        return mapping[intentId] || [];
    }
}

export default new AIIntentService();
