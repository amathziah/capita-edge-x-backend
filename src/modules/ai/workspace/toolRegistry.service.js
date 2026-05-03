import { supabase } from '../../../core/database/supabase.js';
import aiReadModelService from './readModel.service.js';
import aiSemanticSearchService from '../search/semantic.service.js';
import aiActionExecutorService from '../actions/executor.service.js';

const TOOL_DEFINITIONS = {
    get_dashboard_snapshot: {
        id: 'get_dashboard_snapshot',
        label: 'Business Snapshot',
        description: 'Retrieves high-level summary statistics including total revenue, profit margin, number of customers, and cash safe-to-spend. Use for questions about profit, net revenue, or cash runway.',
        uiComponent: null,
        category: 'business_health'
    },
    get_recent_activity: {
        id: 'get_recent_activity',
        label: 'Recent Activity',
        description: 'Gets the 5 most recent invoices, payments, and expenses. Use when asked "what happened recently", "recent activity", or "last week updates".',
        uiComponent: null,
        category: 'activity'
    },
    get_invoice_workspace: {
        id: 'get_invoice_workspace',
        label: 'Invoice Workspace',
        description: 'Retrieves outstanding invoices, overdue amounts, AR aging, draft invoices, and top debtors. Use for ANY query mentioning invoices, collections, receivables, or who owes money.',
        uiComponent: 'ai_domain_invoices',
        category: 'invoices'
    },
    get_payment_workspace: {
        id: 'get_payment_workspace',
        label: 'Payment Workspace',
        description: 'Retrieves completed and pending payments, recent receipts, and collections this month. Use for ANY query mentioning payments, money received, cash in, or receipts.',
        uiComponent: 'ai_domain_payments',
        category: 'payments'
    },
    get_expense_workspace: {
        id: 'get_expense_workspace',
        label: 'Expense Workspace',
        description: 'Retrieves expense patterns, recent spending, top expense categories, and total outflows. Use for ANY query mentioning expenses, cost, spend, vendor bills, or outflows.',
        uiComponent: 'ai_domain_expenses',
        category: 'expenses'
    },
    get_compliance_workspace: {
        id: 'get_compliance_workspace',
        label: 'Compliance Workspace',
        description: 'Retrieves compliance tasks, upcoming deadlines, and overdue tax filings. Use for queries regarding due dates, pending compliance, gst filing, or overdue compliance tasks.',
        uiComponent: 'ai_domain_compliance',
        category: 'compliance'
    },
    get_knowledge_base: {
        id: 'get_knowledge_base',
        label: 'Business Knowledge',
        description: 'Searches the user\'s uploaded business knowledge base policies, guidelines, and rules. Use for queries asking about rules, general compliance knowledge, support policies, office hours, handling refunds, etc.',
        uiComponent: null,
        category: 'knowledge',
        supportsSemanticSearch: true
    },
    get_customer_insights: {
        id: 'get_customer_insights',
        label: 'Customer Insights',
        description: 'Gets insights and portfolio health scores across the entire customer base. Use for queries regarding top customers, churn risk, or customer analytics.',
        uiComponent: 'ai_domain_customers',
        category: 'customers'
    },
    get_customer_details: {
        id: 'get_customer_details',
        label: 'Customer Intelligence',
        description: 'Gets advanced intelligence (churn risk, next purchase date) for a specific customer. Use when asking about a specific client or predicting their next purchase.',
        uiComponent: 'ai_domain_customers',
        category: 'customers'
    },
    get_overdue_invoices: {
        id: 'get_overdue_invoices',
        label: 'Overdue Invoices',
        description: 'Retrieves highly critical overdue receivables and their ageing. Use for queries strictly focusing on overdue invoices or risky uncollected cash.',
        uiComponent: 'ai_domain_invoices',
        category: 'invoices'
    },
    get_cash_flow_trend: {
        id: 'get_cash_flow_trend',
        label: 'Cash Flow Trend',
        description: 'Analyzes cash flow over time showing incoming vs outgoing trends. Use for questions about cash trend, growing or declining cash position.',
        uiComponent: null,
        category: 'cash_flow'
    },
    get_profitability_analysis: {
        id: 'get_profitability_analysis',
        label: 'Profitability Analysis',
        description: 'Calculates profit margins, revenue vs expense ratios, and profitability trends. Use for questions about profit, margins, or financial performance.',
        uiComponent: null,
        category: 'business_health'
    },
    get_customer_payment_history: {
        id: 'get_customer_payment_history',
        label: 'Customer Payment History',
        description: 'Retrieves payment history for a specific customer including payment timing and patterns. Use when asking about a specific customer\'s payment behavior.',
        uiComponent: 'ai_domain_customers',
        category: 'customers'
    },
    get_expense_category_breakdown: {
        id: 'get_expense_category_breakdown',
        label: 'Expense Category Breakdown',
        description: 'Shows detailed breakdown of expenses by category with trends. Use for detailed expense analysis by category.',
        uiComponent: 'ai_domain_expenses',
        category: 'expenses'
    },
    get_upcoming_deadlines: {
        id: 'get_upcoming_deadlines',
        label: 'Upcoming Deadlines',
        description: 'Lists all upcoming compliance deadlines and due dates in the next 30 days. Use for questions about what\'s due soon.',
        uiComponent: 'ai_domain_compliance',
        category: 'compliance'
    },
    get_business_metrics_summary: {
        id: 'get_business_metrics_summary',
        label: 'Business Metrics Summary',
        description: 'Comprehensive metrics including KPIs like revenue growth, expense ratio, customer acquisition cost, etc. Use for detailed business analytics.',
        uiComponent: null,
        category: 'business_health'
    },
    predict_cash_shortfall: {
        id: 'predict_cash_shortfall',
        label: 'Cash Shortfall Predictor',
        description: 'Predicts whether the business will face a cash shortfall in the next 30 days based on overdue receivables, expected payments, and upcoming expenses. Use for questions about cash runway, "will I run out of money", "can I afford X", or "what is my cash position next month".',
        uiComponent: null,
        category: 'cash_flow'
    },
    get_payment_patterns: {
        id: 'get_payment_patterns',
        label: 'Customer Payment Patterns',
        description: 'Analyzes payment behavior patterns across all customers — who pays on time, who pays late, average delay days, and late-payer risk. Use for questions about which customers are reliable, who to follow up with first, or understanding collection risk.',
        uiComponent: 'ai_domain_customers',
        category: 'customers'
    },
    create_customer: {
        id: 'create_customer',
        label: 'Create Customer',
        description: 'Creates a new customer record in the database. Use this when the user explicitly asks to create or add a new customer.',
        uiComponent: null,
        category: 'customers'
    },
    create_invoice_draft: {
        id: 'create_invoice_draft',
        label: 'Create Draft Invoice',
        description: 'Drafts a new invoice for a customer. Use this when the user asks to create an invoice.',
        uiComponent: null,
        category: 'invoices'
    },
    send_reminder: {
        id: 'send_reminder',
        label: 'Send Invoice Reminder',
        description: 'Sends a collection email or reminder to a customer for an overdue invoice. Use this when the user asks to chase or remind a client.',
        uiComponent: null,
        category: 'invoices'
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

    /**
     * Returns Gemini-compatible functionDeclarations for native tool calling.
     * Args are intentionally minimal — most tools take none; the few that do
     * (customer/knowledge lookup) get a single string parameter.
     */
    getGeminiFunctionDeclarations() {
        const argSchemas = {
            get_customer_details: {
                type: 'object',
                properties: { customerId: { type: 'string', description: 'Customer ID or name to look up.' } }
            },
            get_customer_payment_history: {
                type: 'object',
                properties: { customerId: { type: 'string', description: 'Customer ID or name to look up.' } }
            },
            get_knowledge_base: {
                type: 'object',
                properties: { query: { type: 'string', description: 'The search query for the knowledge base.' } },
                required: ['query']
            },
            create_customer: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Name of the customer or business.' },
                    email: { type: 'string', description: 'Email address of the customer.' },
                    phone: { type: 'string', description: 'Phone number of the customer.' },
                    address: { type: 'string', description: 'Physical address of the customer.' }
                },
                required: ['name']
            },
            create_invoice_draft: {
                type: 'object',
                properties: {
                    customerId: { type: 'string', description: 'ID of the customer.' },
                    customerName: { type: 'string', description: 'Name of the customer if ID is not known.' },
                    customerEmail: { type: 'string', description: 'Email address of the customer (Required).' },
                    customerAddress: { type: 'string', description: 'Physical address of the customer (Required).' },
                    amount: { type: 'number', description: 'Total amount of the invoice.' },
                    items: {
                        type: 'array',
                        description: 'List of line items for the invoice. Ask the user if missing.',
                        items: {
                            type: 'object',
                            properties: {
                                description: { type: 'string' },
                                quantity: { type: 'number' },
                                price: { type: 'number' }
                            },
                            required: ['description', 'quantity', 'price']
                        }
                    },
                    description: { type: 'string', description: 'General description of the invoice.' }
                },
                required: ['customerName', 'customerEmail', 'customerAddress', 'amount', 'items']
            },
            send_reminder: {
                type: 'object',
                properties: {
                    invoiceNumber: { type: 'string', description: 'The invoice number to remind them about.' },
                    customerName: { type: 'string', description: 'Name of the customer.' }
                }
            }
        };

        return Object.values(TOOL_DEFINITIONS).map(tool => ({
            name: tool.id,
            description: tool.description,
            parameters: argSchemas[tool.id] || { type: 'object', properties: {} }
        }));
    }

    /**
     * Map a tool ID to its UI workspace component (if any).
     */
    getUiComponent(toolId) {
        return TOOL_DEFINITIONS[toolId]?.uiComponent || null;
    }

    async executeTool(toolId, context = {}, args = {}) {
        const organizationId = context.organizationId;

        switch (toolId) {
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
                return aiSemanticSearchService.search(organizationId, args.query || context.query || '');
            case 'get_customer_insights':
                return aiReadModelService.getCustomerPortfolio(organizationId);
            case 'get_customer_details':
                return aiReadModelService.getCustomerDetail(organizationId, args.customerId || context.customerId || null);
            case 'get_overdue_invoices':
                return aiReadModelService.getOverdueReceivables(organizationId);
            
            case 'predict_cash_shortfall':
                return this.predictCashShortfall(organizationId);
            case 'get_payment_patterns':
                return this.getPaymentPatterns(organizationId);
            case 'get_cash_flow_trend':
                return this.getCashFlowTrend(organizationId);
            case 'get_profitability_analysis':
                return this.getProfitabilityAnalysis(organizationId);
            case 'get_customer_payment_history':
                return this.getCustomerPaymentHistory(organizationId, args.customerId);
            case 'get_expense_category_breakdown':
                return this.getExpenseCategoryBreakdown(organizationId);
            case 'get_upcoming_deadlines':
                return this.getUpcomingDeadlines(organizationId);
            case 'get_business_metrics_summary':
                return this.getBusinessMetricsSummary(organizationId);
            case 'create_customer':
                return { data: await aiActionExecutorService.createCustomer({ data: args }, context) };
            case 'create_invoice_draft':
                return { data: await aiActionExecutorService.createInvoiceDraft({ data: args }, context) };
            case 'send_reminder':
                return { data: await aiActionExecutorService.sendReminder({ data: args }, context) };
            default:
                throw new Error(`Unknown AI tool: ${toolId}`);
        }
    }

    async predictCashShortfall(organizationId) {
        const [invoices, payments, expenses, snapshot] = await Promise.all([
            aiReadModelService.getInvoiceWorkspace(organizationId),
            aiReadModelService.getPaymentWorkspace(organizationId),
            aiReadModelService.getExpenseWorkspace(organizationId),
            aiReadModelService.getDashboardSnapshot(organizationId)
        ]);

        const cashOnHand = snapshot?.data?.safeToSpend?.cashOnHand || 0;
        const safeToSpend = snapshot?.data?.safeToSpend?.safeToSpend || 0;

        // Expected cash inflows: invoices due in next 30 days
        const today = new Date();
        const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        const overdueAmount = invoices?.data?.summary?.overdueAmount || 0;
        const totalOutstanding = invoices?.data?.summary?.totalOutstanding || 0;
        const expectedInflows = totalOutstanding * 0.6; // conservative 60% collection rate

        // Expected outflows: avg monthly expenses projected forward
        const monthlyBurn = expenses?.data?.summary?.spendThisMonth || 0;
        const projectedOutflows = monthlyBurn;

        const netCash30Days = cashOnHand + expectedInflows - projectedOutflows;
        const isShortfall = netCash30Days < 0;
        const shortfallAmount = isShortfall ? Math.abs(netCash30Days) : 0;
        const daysUntilShortfall = isShortfall && monthlyBurn > 0
            ? Math.floor(cashOnHand / (monthlyBurn / 30))
            : null;

        const riskLevel = isShortfall ? 'high' : netCash30Days < monthlyBurn ? 'medium' : 'low';

        return {
            data: {
                cashOnHand,
                safeToSpend,
                expectedInflows: Math.round(expectedInflows),
                projectedOutflows: Math.round(projectedOutflows),
                netCash30Days: Math.round(netCash30Days),
                isShortfall,
                shortfallAmount: Math.round(shortfallAmount),
                daysUntilShortfall,
                riskLevel,
                overdueReceivables: overdueAmount,
                recommendation: isShortfall
                    ? `Cash shortfall predicted in ${daysUntilShortfall || '< 30'} days. Prioritise collecting ${overdueAmount > 0 ? `the overdue receivables` : 'outstanding invoices'} immediately.`
                    : riskLevel === 'medium'
                    ? 'Cash is tight. Chase overdue invoices before committing to new expenses.'
                    : 'Cash position looks healthy for the next 30 days.'
            },
            meta: {
                source: 'predict_cash_shortfall',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'cash_flow',
                horizon_days: 30
            }
        };
    }

    async getPaymentPatterns(organizationId) {
        const { data: payments, error } = await supabase
            .from('payments')
            .select('customer_id, amount, date, created_at')
            .eq('organization_id', organizationId)
            .order('date', { ascending: false })
            .limit(200);

        if (error || !payments?.length) {
            return {
                data: { patterns: [], summary: { totalCustomers: 0, latePayerCount: 0, onTimeRate: 0 } },
                meta: { source: 'get_payment_patterns', generated_at: new Date().toISOString(), organization_id: organizationId, domain: 'customers' }
            };
        }

        // Group by customer
        const byCustomer = payments.reduce((acc, p) => {
            if (!acc[p.customer_id]) acc[p.customer_id] = [];
            acc[p.customer_id].push(p);
            return acc;
        }, {});

        // Get customer names
        const customerIds = Object.keys(byCustomer);
        const { data: customers } = await supabase
            .from('customers')
            .select('id, name')
            .in('id', customerIds)
            .eq('organization_id', organizationId);

        const nameMap = (customers || []).reduce((acc, c) => { acc[c.id] = c.name; return acc; }, {});

        const patterns = customerIds.map(customerId => {
            const pmts = byCustomer[customerId];
            const totalPaid = pmts.reduce((s, p) => s + (p.amount || 0), 0);
            const count = pmts.length;
            const avgAmount = count > 0 ? totalPaid / count : 0;

            // Classify payment frequency
            const dates = pmts.map(p => new Date(p.date || p.created_at)).sort((a, b) => a - b);
            const gaps = [];
            for (let i = 1; i < dates.length; i++) {
                gaps.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
            }
            const avgGapDays = gaps.length > 0 ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null;
            const reliability = count >= 3 ? (avgGapDays <= 35 ? 'reliable' : avgGapDays <= 60 ? 'slow' : 'irregular') : 'insufficient_data';

            return {
                customerId,
                name: nameMap[customerId] || 'Unknown',
                totalPaid: Math.round(totalPaid),
                paymentCount: count,
                avgPaymentAmount: Math.round(avgAmount),
                avgDaysBetweenPayments: avgGapDays,
                reliability,
                lastPaymentDate: dates[dates.length - 1]?.toISOString().slice(0, 10) || null
            };
        }).sort((a, b) => b.totalPaid - a.totalPaid);

        const latePayerCount = patterns.filter(p => p.reliability === 'slow' || p.reliability === 'irregular').length;
        const reliableCount = patterns.filter(p => p.reliability === 'reliable').length;
        const onTimeRate = patterns.length > 0 ? Math.round((reliableCount / patterns.length) * 100) : 0;

        return {
            data: {
                patterns: patterns.slice(0, 10),
                summary: {
                    totalCustomers: patterns.length,
                    reliablePayerCount: reliableCount,
                    latePayerCount,
                    onTimeRate,
                    topPayer: patterns[0] || null
                }
            },
            meta: {
                source: 'get_payment_patterns',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'customers'
            }
        };
    }

    async getCashFlowTrend(organizationId) {
        const [snapshot, payments, expenses] = await Promise.all([
            aiReadModelService.getDashboardSnapshot(organizationId),
            aiReadModelService.getPaymentWorkspace(organizationId),
            aiReadModelService.getExpenseWorkspace(organizationId)
        ]);

        const cashIn = payments?.data?.summary?.totalCollected || 0;
        const cashOut = expenses?.data?.summary?.totalSpend || 0;
        const netCashFlow = cashIn - cashOut;
        const trend = netCashFlow > 0 ? 'positive' : netCashFlow < 0 ? 'negative' : 'neutral';

        return {
            data: {
                cashIn,
                cashOut,
                netCashFlow,
                trend,
                cashOnHand: snapshot?.data?.safeToSpend?.cashOnHand || 0,
                safeToSpend: snapshot?.data?.safeToSpend?.safeToSpend || 0
            },
            meta: {
                source: 'get_cash_flow_trend',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'cash_flow'
            }
        };
    }

    async getProfitabilityAnalysis(organizationId) {
        const [snapshot, expenses] = await Promise.all([
            aiReadModelService.getDashboardSnapshot(organizationId),
            aiReadModelService.getExpenseWorkspace(organizationId)
        ]);

        const revenue = snapshot?.data?.stats?.total_revenue || 0;
        const totalExpenses = snapshot?.data?.stats?.total_expenses || 0;
        const netProfit = revenue - totalExpenses;
        const profitMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

        return {
            data: {
                revenue,
                totalExpenses,
                netProfit: Math.round(netProfit * 100) / 100,
                profitMargin: Math.round(profitMargin * 10) / 10,
                expenseRatio: revenue > 0 ? Math.round((totalExpenses / revenue) * 1000) / 10 : 0
            },
            meta: {
                source: 'get_profitability_analysis',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'business_health'
            }
        };
    }

    async getCustomerPaymentHistory(organizationId, customerId) {
        const { data: payments, error } = await supabase
            .from('payments')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('customer_id', customerId)
            .order('date', { ascending: false })
            .limit(20);

        if (error) throw error;

        const totalPaid = (payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        const paymentCount = (payments || []).length;
        const avgPayment = paymentCount > 0 ? totalPaid / paymentCount : 0;

        return {
            data: {
                customerId,
                payments: payments || [],
                totalPaid: Math.round(totalPaid * 100) / 100,
                paymentCount,
                averagePayment: Math.round(avgPayment * 100) / 100
            },
            meta: {
                source: 'payments',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'customers'
            }
        };
    }

    async getExpenseCategoryBreakdown(organizationId) {
        const workspace = await aiReadModelService.getExpenseWorkspace(organizationId);
        
        return {
            data: {
                categories: workspace?.data?.topCategories || [],
                totalSpend: workspace?.data?.summary?.totalSpend || 0,
                spendThisMonth: workspace?.data?.summary?.spendThisMonth || 0,
                expenseCount: workspace?.data?.summary?.totalExpenses || 0
            },
            meta: {
                source: 'get_expense_category_breakdown',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'expenses'
            }
        };
    }

    async getUpcomingDeadlines(organizationId) {
        const workspace = await aiReadModelService.getComplianceWorkspace(organizationId);
        
        const today = new Date();
        const thirtyDaysLater = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

        const upcoming = (workspace?.data?.urgentTasks || []).filter(task => {
            if (!task.due_date) return false;
            const dueDate = new Date(task.due_date);
            return dueDate >= today && dueDate <= thirtyDaysLater;
        });

        return {
            data: {
                upcoming,
                totalUpcoming: upcoming.length,
                overdueCount: workspace?.data?.summary?.overdueCount || 0,
                dueThisWeek: workspace?.data?.summary?.dueThisWeekCount || 0
            },
            meta: {
                source: 'get_upcoming_deadlines',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'compliance'
            }
        };
    }

    async getBusinessMetricsSummary(organizationId) {
        const [snapshot, payments, expenses, invoices] = await Promise.all([
            aiReadModelService.getDashboardSnapshot(organizationId),
            aiReadModelService.getPaymentWorkspace(organizationId),
            aiReadModelService.getExpenseWorkspace(organizationId),
            aiReadModelService.getInvoiceWorkspace(organizationId)
        ]);

        const revenue = snapshot?.data?.stats?.total_revenue || 0;
        const totalExpenses = snapshot?.data?.stats?.total_expenses || 0;
        const netProfit = revenue - totalExpenses;
        
        return {
            data: {
                revenue,
                totalExpenses,
                netProfit,
                profitMargin: snapshot?.data?.stats?.profit_margin || 0,
                cashPosition: snapshot?.data?.safeToSpend?.safeToSpend || 0,
                collectionRate: invoices?.data?.summary?.paidCount || 0,
                pendingPayments: payments?.data?.summary?.pendingCount || 0,
                overdueInvoices: invoices?.data?.summary?.overdueCount || 0,
                totalCustomers: snapshot?.data?.stats?.total_customers || 0
            },
            meta: {
                source: 'get_business_metrics_summary',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'business_health'
            }
        };
    }
}

export default new AIToolRegistryService();
