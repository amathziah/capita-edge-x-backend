import { supabase } from '../supabase.js';
import { DEFAULTS, HEALTH_SCORE, TAX_RESERVES, PLACEHOLDERS } from '../config/constants.js';

/**
 * Analytics Service
 * Provides business intelligence, reporting, and data export capabilities
 */
class AnalyticsService {

    /**
     * Get revenue trends over time
     */
    async getRevenueTrends(organizationId, period = 'monthly') {
        if (!organizationId) throw new Error('Organization ID required');

        // Fetch all invoices created in the last 12 months
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('createdAt, status, total')
            .eq('organization_id', organizationId)
            .gte('createdAt', oneYearAgo.toISOString());

        if (error) throw new Error(error.message);

        // Fetch expenses
        const { data: expenses, error: expenseError } = await supabase
            .from('expenses')
            .select('date, amount')
            .eq('organization_id', organizationId)
            .gte('date', oneYearAgo.toISOString());

        if (expenseError) throw new Error(expenseError.message);

        // Process in-memory
        const trends = {};

        const getKey = (dateStr) => {
            const date = new Date(dateStr);
            if (period === 'daily') {
                return date.toISOString().split('T')[0];
            } else if (period === 'weekly') {
                const startOfYear = new Date(date.getFullYear(), 0, 1);
                const pastDays = (date.getTime() - startOfYear.getTime()) / 86400000;
                const weekNum = Math.ceil((pastDays + startOfYear.getDay() + 1) / 7);
                return `${date.getFullYear()}-W${weekNum}`;
            } else {
                // Monthly default
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }
        };

        const initKey = (key) => {
            if (!trends[key]) {
                trends[key] = {
                    period: key,
                    invoice_count: 0,
                    revenue: 0,
                    expenses: 0,
                    pending: 0,
                    overdue: 0
                };
            }
        };

        invoices.forEach(inv => {
            const key = getKey(inv.createdAt);
            initKey(key);

            trends[key].invoice_count++;
            if (inv.status === 'paid') {
                trends[key].revenue += inv.total;
            } else if (['sent', 'overdue', 'draft'].includes(inv.status)) { // aggregated pending
                if (inv.status === 'overdue') {
                    trends[key].overdue += inv.total;
                    trends[key].pending += inv.total;
                } else {
                    trends[key].pending += inv.total;
                }
            }
        });

        expenses.forEach(exp => {
            const key = getKey(exp.date);
            initKey(key);
            trends[key].expenses += exp.amount;
        });

        // Convert object to array and sort
        return Object.values(trends).sort((a, b) => a.period.localeCompare(b.period));
    }

    /**
     * Get customer insights
     */
    async getCustomerInsights(organizationId) {
        if (!organizationId) throw new Error('Organization ID required');

        const { data: customers, error: custError } = await supabase
            .from('customers')
            .select('id, name, email')
            .eq('organization_id', organizationId);

        if (custError) throw new Error(custError.message);

        const { data: invoices, error: invError } = await supabase
            .from('invoices')
            .select('id, customerId, status, total, createdAt')
            .eq('organization_id', organizationId);

        if (invError) throw new Error(invError.message);

        // Map invoices to customers
        const customerStats = {};

        customers.forEach(c => {
            customerStats[c.id] = {
                id: c.id,
                name: c.name,
                email: c.email,
                total_invoices: 0,
                total_revenue: 0,
                pending_amount: 0,
                last_invoice_date: null,
                _total_value_for_avg: 0
            };
        });

        invoices.forEach(inv => {
            if (customerStats[inv.customerId]) {
                const stats = customerStats[inv.customerId];
                stats.total_invoices++;
                stats._total_value_for_avg += inv.total;

                if (inv.status === 'paid') {
                    stats.total_revenue += inv.total;
                } else if (['sent', 'overdue'].includes(inv.status)) {
                    stats.pending_amount += inv.total;
                }

                if (!stats.last_invoice_date || new Date(inv.createdAt) > new Date(stats.last_invoice_date)) {
                    stats.last_invoice_date = inv.createdAt;
                }
            }
        });

        return Object.values(customerStats).map(s => ({
            ...s,
            avg_invoice_value: s.total_invoices > 0 ? s._total_value_for_avg / s.total_invoices : 0
        })).sort((a, b) => b.total_revenue - a.total_revenue);
    }

    /**
     * Get product performance metrics
     */
    async getProductPerformance(organizationId) {
        if (!organizationId) throw new Error('Organization ID required');

        // We need invoice items and products
        const { data: products, error: prodError } = await supabase
            .from('products')
            .select('id, name, price, stock, minStock')
            .eq('organization_id', organizationId);

        if (prodError) throw new Error(prodError.message);

        // Invoice items generally rely on invoiceId, but for strictness we could filter by invoices first
        // or assume RLS handles it. But for analytics, let's fetch items for the Org's invoices or products.
        // A direct join or explicit fetch is better.
        // Simplified: Fetch items where productId is in our Org's products list.
        const productIds = products.map(p => p.id);

        let items = [];
        if (productIds.length > 0) {
            const { data: fetchedItems, error: itemError } = await supabase
                .from('invoice_items')
                .select('id, productId, quantity, price')
                .in('productId', productIds);

            if (itemError) throw new Error(itemError.message);
            items = fetchedItems;
        }

        const productStats = {};

        products.forEach(p => {
            productStats[p.id] = {
                ...p,
                times_sold: 0,
                total_quantity_sold: 0,
                total_revenue: 0
            };
        });

        items.forEach(item => {
            if (productStats[item.productId]) {
                const stats = productStats[item.productId];
                stats.times_sold++;
                stats.total_quantity_sold += item.quantity;
                stats.total_revenue += (item.quantity * item.price);
            }
        });

        return Object.values(productStats).sort((a, b) => b.total_revenue - a.total_revenue);
    }

    /**
     * Get cash flow analysis
     */
    async getCashFlowAnalysis(organizationId) {
        if (!organizationId) throw new Error('Organization ID required');

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Invoices
        const { data: invoices, error: invError } = await supabase
            .from('invoices')
            .select('status, total, createdAt')
            .eq('organization_id', organizationId);

        if (invError) throw new Error(invError.message);

        // Expenses
        const { data: expenses, error: expError } = await supabase
            .from('expenses')
            .select('amount, date')
            .eq('organization_id', organizationId)
            .gte('date', thirtyDaysAgo.toISOString());

        if (expError) throw new Error(expError.message);

        let total_received = 0;
        let total_pending = 0;
        let monthly_revenue = 0;

        invoices.forEach(inv => {
            if (inv.status === 'paid') {
                total_received += inv.total;
                if (new Date(inv.createdAt) >= thirtyDaysAgo) {
                    monthly_revenue += inv.total;
                }
            } else if (['sent', 'overdue'].includes(inv.status)) {
                total_pending += inv.total;
            }
        });

        const monthly_expenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
        const netCashFlow = monthly_revenue - monthly_expenses;

        return {
            total_received,
            total_pending,
            monthly_expenses,
            monthly_revenue,
            net_cash_flow: netCashFlow,
            cash_flow_health: netCashFlow > 0 ? 'positive' : 'negative'
        };
    }

    /**
     * Get dashboard statistics
     */
    async getDashboardStats(organizationId) {
        if (!organizationId) throw new Error('Organization ID required');

        // Fetch base data
        const { data: invoices, error: invError } = await supabase
            .from('invoices')
            .select('id, status, total')
            .eq('organization_id', organizationId);

        if (invError) throw new Error(invError.message);

        const { count: customerCount, error: custError } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId);
        if (custError) throw new Error(custError.message);

        const { data: products, error: prodError } = await supabase
            .from('products')
            .select('stock, minStock, cost_price, is_inventory_tracked')
            .eq('organization_id', organizationId);
        if (prodError) throw new Error(prodError.message);

        const stats = {
            paid_invoices: 0,
            pending_invoices: 0,
            overdue_invoices: 0,
            total_revenue: 0,
            pending_payments: 0,
            overdue_revenue: 0,
            total_customers: customerCount || 0,
            total_products: products?.length || 0,
            low_stock_items: 0,
            inventory_value: 0
        };

        invoices.forEach(inv => {
            if (inv.status === 'paid') {
                stats.paid_invoices++;
                stats.total_revenue += inv.total;
            } else if (['sent', 'overdue'].includes(inv.status)) {
                stats.pending_invoices++;
                stats.pending_payments += inv.total;
                if (inv.status === 'overdue') {
                    stats.overdue_invoices++;
                    stats.overdue_revenue += inv.total;
                }
            }
        });

        if (products) {
            stats.low_stock_items = products.filter(p => p.is_inventory_tracked && p.stock <= (p.minStock || 10)).length;
            stats.inventory_value = products.reduce((sum, p) => sum + (p.stock * (p.cost_price || 0)), 0);
        }

        return stats;
    }

    /**
     * Export data to CSV format
     */
    async exportToCSV(type = 'invoices', filters = {}, organizationId) {
        if (!organizationId) throw new Error('Organization ID required');

        let data = [];
        let headers = [];

        switch (type) {
            case 'invoices':
                const { data: invoices } = await supabase
                    .from('invoices')
                    .select('invoiceNumber, buyer, total, status, createdAt, dueDate')
                    .eq('organization_id', organizationId)
                    .order('createdAt', { ascending: false });

                data = invoices;
                headers = ['Invoice Number', 'Customer', 'Total', 'Status', 'Created', 'Due Date'];
                data = data.map(row => [
                    row.invoiceNumber,
                    (typeof row.buyer === 'string' ? JSON.parse(row.buyer).name : row.buyer?.name) || '',
                    row.total,
                    row.status,
                    row.createdAt,
                    row.dueDate
                ]);
                break;

            case 'customers':
                const { data: customers } = await supabase
                    .from('customers')
                    .select('name, email, phone, address')
                    .eq('organization_id', organizationId)
                    .order('name');
                data = customers;
                headers = ['Name', 'Email', 'Phone', 'Address'];
                data = data.map(row => [row.name, row.email, row.phone, row.address]);
                break;

            case 'products':
                const { data: products } = await supabase
                    .from('products')
                    .select('name, price, stock, unit')
                    .eq('organization_id', organizationId)
                    .order('name');
                data = products;
                headers = ['Name', 'Price', 'Stock', 'Unit'];
                data = data.map(row => [row.name, row.price, row.stock, row.unit]);
                break;

            case 'payments':
                const { data: payments } = await supabase
                    .from('payments')
                    .select(`
                        amount, date, method,
                        invoices ( invoiceNumber )
                    `)
                    .eq('organization_id', organizationId) // Direct filter safer than join filter for RLS
                    .order('date', { ascending: false });
                data = payments;
                headers = ['Amount', 'Date', 'Method', 'Invoice'];
                data = data.map(row => [
                    row.amount,
                    row.date,
                    row.method,
                    row.invoices?.invoiceNumber || 'Unknown'
                ]);
                break;

            default:
                throw new Error('Invalid export type');
        }

        // Convert to CSV
        const csvRows = [headers.join(',')];
        data.forEach(row => {
            const csvRow = row.map(cell => {
                const cellStr = String(cell || '');
                // Escape quotes and wrap in quotes if contains comma
                if (cellStr.includes(',') || cellStr.includes('"')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                }
                return cellStr;
            });
            csvRows.push(csvRow.join(','));
        });

        return csvRows.join('\n');
    }

    /**
     * Get business health score
     */
    async getBusinessHealthScore(organizationId) {
        const stats = await this.getDashboardStats(organizationId);
        const cashFlow = await this.getCashFlowAnalysis(organizationId);

        // Calculate score based on multiple factors
        let score = 100;

        // Revenue factor
        const revenueScore = Math.min(HEALTH_SCORE.REVENUE_MAX_POINTS, (stats.total_revenue / HEALTH_SCORE.REVENUE_BENCHMARK) * HEALTH_SCORE.REVENUE_MAX_POINTS);
        score = revenueScore;

        // Overdue factor
        const overdueRatio = stats.overdue_invoices / Math.max(1, stats.paid_invoices + stats.pending_invoices);
        score -= overdueRatio * HEALTH_SCORE.OVERDUE_MAX_PENALTY;

        // Cash flow factor
        if (cashFlow.net_cash_flow > 0) {
            score += HEALTH_SCORE.CASH_FLOW_MAX_BONUS;
        } else {
            score += Math.max(0, HEALTH_SCORE.CASH_FLOW_MAX_BONUS + (cashFlow.net_cash_flow / HEALTH_SCORE.CASH_FLOW_SCALING) * HEALTH_SCORE.CASH_FLOW_MAX_BONUS);
        }

        // Stock management factor
        const stockScore = stats.low_stock_items > 0 ? HEALTH_SCORE.STOCK_PARTIAL_BONUS : HEALTH_SCORE.STOCK_FULL_BONUS;
        score += stockScore;

        return {
            score: Math.max(0, Math.min(100, Math.round(score))),
            factors: {
                revenue: Math.round(revenueScore),
                overdue: Math.round(-overdueRatio * HEALTH_SCORE.OVERDUE_MAX_PENALTY),
                cashFlow: cashFlow.cash_flow_health === 'positive' ? HEALTH_SCORE.CASH_FLOW_MAX_BONUS : (HEALTH_SCORE.CASH_FLOW_MAX_BONUS / 2),
                inventory: stockScore
            }
        };
    }
    /**
     * Calculate Safe-to-Spend Liquidity
     * Logic: Real Cash (Payments) - Computed Burn - Reserves - Risk
     */
    async getSafeToSpend(organizationId) {
        // 1. Get Actual Cash on Hand (Sum of all payments received)
        const { data: payments, error: payError } = await supabase
            .from('payments')
            .select('amount')
            .eq('organization_id', organizationId);

        if (payError) throw new Error(payError.message);

        const bankBalance = payments.reduce((sum, p) => sum + p.amount, 0);

        // 2. Tax Reserves (Estimates)
        const gstReserve = bankBalance * TAX_RESERVES.GST_RATE;
        const incomeTaxReserve = bankBalance * TAX_RESERVES.INCOME_TAX_RATE;

        // 3. Risk Factor
        const { data: overdueInvoices } = await supabase
            .from('invoices')
            .select('total')
            .eq('organization_id', organizationId)
            .eq('status', 'overdue');

        const overdueTotal = overdueInvoices?.reduce((sum, inv) => sum + inv.total, 0) || 0;
        const atRiskAmount = overdueTotal * TAX_RESERVES.OVERDUE_RISK_FACTOR;

        // 4. Calculate Safe Liquidity
        // Safe = Cash - Taxes - Risk
        const safeToSpend = bankBalance - gstReserve - incomeTaxReserve - atRiskAmount;

        return {
            safeToSpend: Math.max(0, safeToSpend),
            totalRevenue: bankBalance, // Displaying "Cash on Hand" as the base
            reserves: {
                gst: gstReserve,
                incomeTax: incomeTaxReserve,
                atRisk: atRiskAmount,
                overdueTotal: overdueTotal
            }
        };
    }

    /**
     * Get statistics tailored to a specific business persona
     */
    async getPersonaStats(organizationId, persona) {
        if (!organizationId) throw new Error('Organization ID required');

        const now = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const stats = {
            persona,
            metrics: {},
            recentActivity: []
        };

        // 1. Fetch Recent Activity (Global)
        const { data: activities } = await supabase
            .from('invoices')
            .select('invoiceNumber, buyer, total, status, createdAt')
            .eq('organization_id', organizationId)
            .order('createdAt', { ascending: false })
            .limit(5);

        stats.recentActivity = (activities || []).map(a => ({
            type: 'invoice',
            title: `Invoice #${a.invoiceNumber} ${a.status}`,
            description: `${typeof a.buyer === 'string' ? JSON.parse(a.buyer).name : a.buyer?.name || 'Customer'} - ₹${a.total}`,
            timestamp: a.createdAt
        }));

        // 2. Fetch Persona Specific Metrics
        switch (persona) {
            case 'solopreneur':
                const liquidity = await this.getSafeToSpend(organizationId);
                const cashFlow = await this.getCashFlowAnalysis(organizationId);
                stats.metrics = {
                    cashFlow: cashFlow.net_cash_flow,
                    taxProvision: liquidity.reserves.gst + liquidity.reserves.incomeTax,
                    openReminders: 0 // Placeholder until reminder service integrated
                };
                break;

            case 'subscription':
                const { data: saasInvoices } = await supabase
                    .from('invoices')
                    .select('total, status, createdAt')
                    .eq('organization_id', organizationId)
                    .gte('createdAt', thirtyDaysAgo.toISOString());

                const paid = saasInvoices?.filter(i => i.status === 'paid') || [];
                const mrr = paid.reduce((sum, i) => sum + i.total, 0);
                const churnCount = saasInvoices?.filter(i => i.status === 'canceled').length || 0;

                stats.metrics = {
                    mrr,
                    churnRate: (churnCount / Math.max(1, saasInvoices?.length || 0)) * 100,
                    activeSubs: paid.length // Simplified proxy
                };
                break;

            case 'services_firm':
                const { data: agencyInvoices } = await supabase
                    .from('invoices')
                    .select('status')
                    .eq('organization_id', organizationId);

                const active = agencyInvoices?.filter(i => ['sent', 'overdue'].includes(i.status)).length || 0;

                stats.metrics = {
                    activeProjects: active,
                    projectHealth: PLACEHOLDERS.SERVICES_PROJECT_HEALTH, // Placeholder
                    pipelineValue: agencyInvoices?.reduce((sum, i) => sum + (i.status === 'draft' ? i.total : 0), 0) || 0
                };
                break;

            case 'ecommerce':
                const { data: ecoProducts } = await supabase
                    .from('products')
                    .select('stock, minStock, is_inventory_tracked')
                    .eq('organization_id', organizationId);

                const lowStock = ecoProducts?.filter(p => p.is_inventory_tracked && p.stock <= (p.minStock || DEFAULTS.DEFAULT_REORDER_LEVEL)).length || 0;
                const { count: dailyOrders } = await supabase
                    .from('invoices')
                    .select('*', { count: 'exact', head: true })
                    .eq('organization_id', organizationId)
                    .gte('createdAt', new Date(now.setHours(0, 0, 0, 0)).toISOString());

                stats.metrics = {
                    lowStockItems: lowStock,
                    dailyOrders: dailyOrders || 0,
                    netMargins: PLACEHOLDERS.ECOMMERCE_NET_MARGINS // Placeholder
                };
                break;
        }

        return stats;
    }
}

export default new AnalyticsService();
