import { supabase } from '../../core/database/supabase.js';
import analyticsService from '../analytics/analytics.service.js';
import { mapConfigToFrontend } from '../../core/utils/configUtils.js';
import {
    attachResolvedInvoiceStatus,
    getDaysOverdue,
    getInvoiceAmounts,
    resolveInvoiceStatus
} from '../invoices/invoiceStatus.service.js';

class AIReadModelService {
    async getOrganizationContext(organizationId) {
        const { data: config, error } = await supabase
            .from('organization_configs')
            .select('*')
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (error) throw error;

        const settings = mapConfigToFrontend(config || {});

        return {
            settings: settings || {},
            currency: settings?.currency || 'INR',
            businessName: settings?.business_name || settings?.businessName || 'your business',
            businessType: settings?.business_type || settings?.businessType || 'solopreneur',
            planTier: settings?.plan_tier || 'starter'
        };
    }

    async getDashboardSnapshot(organizationId) {
        const [{ settings, currency }, statsResult, safeToSpendResult] = await Promise.all([
            this.getOrganizationContext(organizationId),
            analyticsService.getDashboardStats(organizationId).catch(() => null),
            analyticsService.getSafeToSpend(organizationId).catch(() => null)
        ]);

        const stats = statsResult || {
            total_invoices: 0,
            paid_invoices: 0,
            pending_invoices: 0,
            draft_invoices: 0,
            overdue_invoices: 0,
            total_revenue: 0,
            pending_payments: 0,
            overdue_revenue: 0,
            total_customers: 0,
            total_clients: 0,
            total_expenses: 0
        };
        const safeToSpend = safeToSpendResult || {
            safeToSpend: 0,
            cashOnHand: 0,
            totalRevenue: 0,
            totalExpenses: 0,
            currency
        };

        const totalRevenue = stats.total_revenue || 0;
        const totalExpenses = stats.total_expenses || 0;
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        return {
            data: {
                stats: {
                    ...stats,
                    total_clients: stats.total_customers || 0,
                    net_profit: netProfit,
                    profit_margin: Number(profitMargin.toFixed(2))
                },
                safeToSpend,
                currency
            },
            meta: {
                source: 'analytics.getDashboardStats+analytics.getSafeToSpend',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency,
                settings
            }
        };
    }

    async getBusinessAdvisorContext(organizationId, query = '') {
        const lowerQuery = String(query || '').toLowerCase();
        const includesAny = (tokens = []) => tokens.some((token) => lowerQuery.includes(token));
        const asksRecent = includesAny(['recent', 'recently', 'latest', 'this week', 'last week', 'what happened']);
        const needsInvoices = includesAny([
            'invoice', 'invoices', 'receivable', 'receivables', 'collections', 'overdue', 'customer owes'
        ]);
        const needsPayments = includesAny([
            'payment', 'payments', 'collections', 'cash in', 'received', 'receipt'
        ]);
        const needsExpenses = includesAny([
            'expense', 'expenses', 'spend', 'spending', 'cost', 'burn', 'vendor'
        ]);
        const needsCompliance = includesAny([
            'compliance', 'gst', 'tds', 'tax', 'filing', 'deadline', 'return'
        ]);
        const asksBroadBusiness = includesAny([
            'business', 'finance', 'financial', 'focus', 'priority', 'priorities', 'improve',
            'improvement', 'optimize', 'optimise', 'best move', 'how are we doing',
            'how is the business doing', 'biggest risk', 'growth', 'profit', 'runway',
            'cash flow', 'cashflow', 'safe to spend', 'margin', 'overview'
        ]);

        const includeSnapshot = asksBroadBusiness || includesAny([
            'cash flow', 'cashflow', 'safe to spend', 'runway', 'liquidity',
            'business health', 'how are we doing', 'how is the business doing',
            'overall', 'summary', 'full picture', 'overview', 'best move', 'priority'
        ]);
        const includeInvoices = asksBroadBusiness || needsInvoices;
        const includePayments = asksBroadBusiness || needsPayments;
        const includeExpenses = asksBroadBusiness || needsExpenses;
        const includeCompliance = asksBroadBusiness || needsCompliance;
        const includeRecentActivity = asksRecent || asksBroadBusiness;

        const [
            organization,
            snapshot,
            recentActivity,
            invoices,
            payments,
            expenses,
            compliance
        ] = await Promise.all([
            this.getOrganizationContext(organizationId),
            includeSnapshot ? this.getDashboardSnapshot(organizationId) : Promise.resolve(null),
            includeRecentActivity ? this.getRecentActivity(organizationId) : Promise.resolve(null),
            includeInvoices ? this.getInvoiceWorkspace(organizationId) : Promise.resolve(null),
            includePayments ? this.getPaymentWorkspace(organizationId) : Promise.resolve(null),
            includeExpenses ? this.getExpenseWorkspace(organizationId) : Promise.resolve(null),
            includeCompliance ? this.getComplianceWorkspace(organizationId) : Promise.resolve(null)
        ]);

        return {
            data: {
                queryProfile: {
                    asksBroadBusiness,
                    asksRecent,
                    includeSnapshot,
                    includeInvoices,
                    includePayments,
                    includeExpenses,
                    includeCompliance,
                    includeRecentActivity
                },
                business: {
                    name: organization.businessName,
                    type: organization.businessType,
                    currency: organization.currency,
                    planTier: organization.planTier
                },
                snapshot: snapshot?.data || null,
                recentActivity: recentActivity?.data || null,
                invoices: invoices?.data || null,
                payments: payments?.data || null,
                expenses: expenses?.data || null,
                compliance: compliance?.data || null
            },
            meta: {
                source: 'aiReadModel.getBusinessAdvisorContext',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency: organization.currency,
                domain: 'business_advisor'
            }
        };
    }

    async getInvoiceWorkspace(organizationId) {
        const [{ currency }, res] = await Promise.all([
            this.getOrganizationContext(organizationId),
            supabase
                .from('invoices')
                .select('*')
                .eq('organization_id', organizationId)
                .order('createdAt', { ascending: false })
                .limit(50)
        ]);

        if (res.error) throw res.error;

        const invoices = (res.data || []).map((invoice) => {
            const resolved = attachResolvedInvoiceStatus(invoice);
            const { totalAmount, balanceDue } = getInvoiceAmounts(invoice);
            return {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                dueDate: invoice.dueDate || invoice.due_date || null,
                createdAt: invoice.createdAt || null,
                buyer: invoice.buyer || null,
                total: totalAmount,
                balanceDue,
                status: resolved.status,
                daysOverdue: getDaysOverdue(invoice)
            };
        });

        const summary = {
            totalInvoices: invoices.length,
            draftCount: 0,
            sentCount: 0,
            paidCount: 0,
            overdueCount: 0,
            totalOutstanding: 0,
            overdueAmount: 0
        };

        invoices.forEach((invoice) => {
            if (invoice.status === 'draft') summary.draftCount += 1;
            if (invoice.status === 'sent' || invoice.status === 'partially_paid') summary.sentCount += 1;
            if (invoice.status === 'paid') summary.paidCount += 1;
            if (invoice.status === 'overdue') {
                summary.overdueCount += 1;
                summary.overdueAmount += invoice.balanceDue;
            }
            if (['sent', 'partially_paid', 'overdue'].includes(invoice.status)) {
                summary.totalOutstanding += invoice.balanceDue;
            }
        });

        return {
            data: {
                summary,
                recentInvoices: invoices.slice(0, 5),
                overdueInvoices: invoices.filter((invoice) => invoice.status === 'overdue').slice(0, 5),
                topDebtors: this._calculateTopDebtors(invoices),
                currency
            },
            meta: {
                source: 'invoices+invoiceStatus.service',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency,
                domain: 'invoices'
            }
        };
    }

    _calculateTopDebtors(invoices) {
        const debtors = {};
        invoices.forEach((inv) => {
            if (inv.balanceDue > 0 && inv.buyer?.name) {
                const name = inv.buyer.name;
                debtors[name] = (debtors[name] || 0) + inv.balanceDue;
            }
        });
        return Object.entries(debtors)
            .map(([name, balanceDue]) => ({ name, balanceDue }))
            .sort((a, b) => b.balanceDue - a.balanceDue)
            .slice(0, 5);
    }

    async getOverdueReceivables(organizationId) {
        const [{ currency }, res] = await Promise.all([
            this.getOrganizationContext(organizationId),
            supabase
                .from('invoices')
                .select('*')
                .eq('organization_id', organizationId)
                .order('dueDate', { ascending: true })
        ]);

        if (res.error) throw res.error;

        const overdueInvoices = (res.data || [])
            .filter((invoice) => resolveInvoiceStatus(invoice) === 'overdue')
            .map((invoice) => {
                const resolved = attachResolvedInvoiceStatus(invoice);
                const { totalAmount, balanceDue } = getInvoiceAmounts(invoice);
                return {
                    id: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    dueDate: invoice.dueDate || invoice.due_date || null,
                    total: totalAmount,
                    balanceDue,
                    buyer: invoice.buyer || null,
                    status: resolved.status,
                    daysOverdue: getDaysOverdue(invoice)
                };
            });

        const ageing = { current: 0, near: 0, critical: 0, totalOverdue: 0 };
        for (const invoice of overdueInvoices) {
            ageing.totalOverdue += invoice.balanceDue;
            if (invoice.daysOverdue <= 30) ageing.current += invoice.balanceDue;
            else if (invoice.daysOverdue <= 60) ageing.near += invoice.balanceDue;
            else ageing.critical += invoice.balanceDue;
        }

        return {
            data: {
                ageing,
                riskyInvoices: overdueInvoices.slice(0, 5),
                currency
            },
            meta: {
                source: 'invoices+invoiceStatus.service',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency
            }
        };
    }

    async getRecentActivity(organizationId) {
        const [{ currency }, invoices, payments, expenses] = await Promise.all([
            this.getOrganizationContext(organizationId),
            supabase.from('invoices').select('*').eq('organization_id', organizationId).order('createdAt', { ascending: false }).limit(5),
            supabase.from('payments').select('*, customers(name)').eq('organization_id', organizationId).order('date', { ascending: false }).limit(5),
            supabase.from('expenses').select('*').eq('organization_id', organizationId).order('date', { ascending: false }).limit(5)
        ]);

        if (invoices.error) throw invoices.error;
        if (payments.error) throw payments.error;
        if (expenses.error) throw expenses.error;

        return {
            data: {
                invoices: (invoices.data || []).map((invoice) => {
                    const resolved = attachResolvedInvoiceStatus(invoice);
                    const { totalAmount, balanceDue } = getInvoiceAmounts(invoice);
                    return {
                        ...invoice,
                        status: resolved.status,
                        total: totalAmount,
                        balanceDue
                    };
                }),
                payments: payments.data || [],
                expenses: expenses.data || [],
                currency
            },
            meta: {
                source: 'invoices+payments+expenses',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency
            }
        };
    }

    async getPaymentWorkspace(organizationId) {
        const [{ currency }, paymentsRes] = await Promise.all([
            this.getOrganizationContext(organizationId),
            supabase
                .from('payments')
                .select('*')
                .eq('organization_id', organizationId)
                .order('date', { ascending: false })
                .limit(50)
        ]);

        if (paymentsRes.error) throw paymentsRes.error;

        const payments = paymentsRes.data || [];
        const currentMonth = new Date().toISOString().slice(0, 7);
        const summary = {
            totalPayments: payments.length,
            completedCount: 0,
            pendingCount: 0,
            totalCollected: 0,
            collectedThisMonth: 0
        };

        payments.forEach((payment) => {
            const amount = Number(payment.amount || 0);
            if ((payment.status || 'completed') === 'completed') {
                summary.completedCount += 1;
                summary.totalCollected += amount;
                if (String(payment.date || '').slice(0, 7) === currentMonth) {
                    summary.collectedThisMonth += amount;
                }
            } else {
                summary.pendingCount += 1;
            }
        });

        return {
            data: {
                summary,
                recentPayments: payments.slice(0, 5),
                pendingPayments: payments
                    .filter((payment) => (payment.status || 'completed') !== 'completed')
                    .slice(0, 5),
                currency
            },
            meta: {
                source: 'payments',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency,
                domain: 'payments'
            }
        };
    }

    async getExpenseWorkspace(organizationId) {
        const [{ currency }, expensesRes] = await Promise.all([
            this.getOrganizationContext(organizationId),
            supabase
                .from('expenses')
                .select('*')
                .eq('organization_id', organizationId)
                .order('date', { ascending: false })
                .limit(50)
        ]);

        if (expensesRes.error) throw expensesRes.error;

        const expenses = expensesRes.data || [];
        const currentMonth = new Date().toISOString().slice(0, 7);
        const categoryTotals = {};
        const summary = {
            totalExpenses: expenses.length,
            totalSpend: 0,
            spendThisMonth: 0,
            averageExpense: 0
        };

        expenses.forEach((expense) => {
            const amount = Number(expense.amount || 0);
            const category = expense.category || 'Other';
            summary.totalSpend += amount;
            if (String(expense.date || '').slice(0, 7) === currentMonth) {
                summary.spendThisMonth += amount;
            }
            categoryTotals[category] = (categoryTotals[category] || 0) + amount;
        });

        summary.averageExpense = summary.totalExpenses > 0
            ? Number((summary.totalSpend / summary.totalExpenses).toFixed(2))
            : 0;

        const topCategories = Object.entries(categoryTotals)
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => Number(b.amount) - Number(a.amount))
            .slice(0, 5);

        return {
            data: {
                summary,
                recentExpenses: expenses.slice(0, 5),
                topCategories,
                currency
            },
            meta: {
                source: 'expenses',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency,
                domain: 'expenses'
            }
        };
    }

    async getComplianceWorkspace(organizationId) {
        const { data: tasks, error } = await supabase
            .from('compliance_tasks')
            .select('*')
            .eq('organization_id', organizationId)
            .order('due_date', { ascending: true })
            .limit(50);

        if (error) throw error;

        const today = new Date();
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + 7);

        const normalizedTasks = (tasks || []).map((task) => {
            const dueDate = task.due_date || null;
            const due = dueDate ? new Date(dueDate) : null;
            const normalizedStatus = task.status === 'pending' && due && due < today
                ? 'overdue'
                : task.status;

            return {
                ...task,
                status: normalizedStatus
            };
        });

        const summary = {
            totalTasks: normalizedTasks.length,
            pendingCount: normalizedTasks.filter((task) => task.status === 'pending').length,
            overdueCount: normalizedTasks.filter((task) => task.status === 'overdue').length,
            completedCount: normalizedTasks.filter((task) => task.status === 'completed').length,
            dueThisWeekCount: normalizedTasks.filter((task) => {
                if (!task.due_date || task.status === 'completed') return false;
                const due = new Date(task.due_date);
                return due >= today && due <= endOfWeek;
            }).length
        };

        return {
            data: {
                summary,
                urgentTasks: normalizedTasks.filter((task) => ['overdue', 'pending'].includes(task.status)).slice(0, 5),
                dueThisWeekTasks: normalizedTasks.filter((task) => {
                    if (!task.due_date || task.status === 'completed') return false;
                    const due = new Date(task.due_date);
                    return due >= today && due <= endOfWeek;
                }).slice(0, 5),
                recentTasks: normalizedTasks.slice(0, 5)
            },
            meta: {
                source: 'compliance_tasks',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                domain: 'compliance'
            }
        };
    }

    async getCustomerPortfolio(organizationId) {
        const [{ currency }, customers] = await Promise.all([
            this.getOrganizationContext(organizationId),
            analyticsService.getCustomerInsights(organizationId)
        ]);

        return {
            data: {
                customers,
                currency
            },
            meta: {
                source: 'analytics.getCustomerInsights',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency
            }
        };
    }

    async getCustomerDetail(organizationId, customerId) {
        const [{ currency }, intelligence] = await Promise.all([
            this.getOrganizationContext(organizationId),
            analyticsService.getCustomerIntelligence(customerId, organizationId)
        ]);

        return {
            data: {
                intelligence,
                currency
            },
            meta: {
                source: 'analytics.getCustomerIntelligence',
                generated_at: new Date().toISOString(),
                organization_id: organizationId,
                currency,
                customer_id: customerId
            }
        };
    }

    async getBusinessKnowledge(organizationId, query = '') {
        const lowerQuery = String(query || '').toLowerCase();
        
        // Simple keyword-based search for now
        const { data: knowledge, error } = await supabase
            .from('business_knowledge')
            .select('*')
            .eq('organization_id', organizationId);

        if (error) throw error;

        // Simple filtering based on query tokens
        const tokens = lowerQuery.split(/\s+/).filter(t => t.length > 3);
        const filtered = (knowledge || []).filter(item => {
            if (!tokens.length) return true;
            const text = `${item.title} ${item.category} ${item.content} ${(item.tags || []).join(' ')}`.toLowerCase();
            return tokens.some(token => text.includes(token));
        });

        return {
            data: {
                results: filtered.slice(0, 5),
                total: filtered.length
            },
            meta: {
                source: 'business_knowledge',
                query: lowerQuery,
                generated_at: new Date().toISOString()
            }
        };
    }
}

export default new AIReadModelService();
