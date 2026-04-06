import { supabase } from '../../core/database/supabase.js';
import analyticsService from '../analytics/analytics.service.js';
import {
    attachResolvedInvoiceStatus,
    getDaysOverdue,
    getInvoiceAmounts,
    resolveInvoiceStatus
} from '../invoices/invoiceStatus.service.js';

class AIReadModelService {
    async getOrganizationContext(organizationId) {
        const { data: settings, error } = await supabase
            .from('settings')
            .select('currency, business_name, businessName, owner_name, full_name, business_type, businessType, plan_tier')
            .eq('organization_id', organizationId)
            .maybeSingle();

        if (error) throw error;

        return {
            settings: settings || {},
            currency: settings?.currency || 'INR',
            businessName: settings?.business_name || settings?.businessName || 'your business',
            businessType: settings?.business_type || settings?.businessType || 'solopreneur',
            planTier: settings?.plan_tier || 'starter'
        };
    }

    async getDashboardSnapshot(organizationId) {
        const [{ settings, currency }, stats, safeToSpend] = await Promise.all([
            this.getOrganizationContext(organizationId),
            analyticsService.getDashboardStats(organizationId),
            analyticsService.getSafeToSpend(organizationId)
        ]);

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
}

export default new AIReadModelService();
