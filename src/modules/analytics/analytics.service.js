import { supabase } from '../../core/database/supabase.js';
import { DEFAULTS, HEALTH_SCORE, TAX_RESERVES, PLACEHOLDERS, CUSTOMER_HEALTH } from '../../core/config/constants.js';

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
            .select('createdAt, status, total, dueDate')
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
            } else if (['pending', 'draft'].includes(inv.status)) { // aggregated pending
                const isOverdue = inv.status === 'pending' && new Date(inv.dueDate) < new Date();
                if (isOverdue) {
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
            .select('id, customer_id, status, total, createdAt, dueDate')
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
            if (customerStats[inv.customer_id]) {
                const stats = customerStats[inv.customer_id];
                stats.total_invoices++;
                stats._total_value_for_avg += inv.total;

                if (inv.status === 'paid') {
                    stats.total_revenue += inv.total;
                } else if (inv.status === 'pending') {
                    stats.pending_amount += inv.total;
                }

                if (!stats.last_invoice_date || new Date(inv.createdAt) > new Date(stats.last_invoice_date)) {
                    stats.last_invoice_date = inv.createdAt;
                }
            }
        });

        return Object.values(customerStats).map(s => {
            const avgInterval = CUSTOMER_HEALTH.DEFAULT_AVG_INTERVAL_DAYS;
            
            // Basic bulk intelligence (simplified for performance)
            let churnRisk = 0;
            if (s.last_invoice_date) {
                const daysSinceLast = (new Date().getTime() - new Date(s.last_invoice_date).getTime()) / (1000 * 60 * 60 * 24);
                churnRisk = Math.min(100, Math.round((daysSinceLast / (avgInterval * 3)) * 100));
            }

            let healthScore = CUSTOMER_HEALTH.BASELINE;
            if (s.total_invoices > CUSTOMER_HEALTH.INVOICE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.INVOICE_BONUS;
            if (s.total_revenue > CUSTOMER_HEALTH.REVENUE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.REVENUE_BONUS;
            healthScore -= (churnRisk / 5);

            let healthLabel = 'Regular';
            if (healthScore >= CUSTOMER_HEALTH.VIP_THRESHOLD) healthLabel = 'VIP';
            else if (healthScore >= CUSTOMER_HEALTH.ACTIVE_THRESHOLD) healthLabel = 'Active';
            else if (healthScore < CUSTOMER_HEALTH.AT_RISK_THRESHOLD) healthLabel = 'At Risk';

            return {
                ...s,
                avg_invoice_value: s.total_invoices > 0 ? s._total_value_for_avg / s.total_invoices : 0,
                health_label: healthLabel,
                churn_risk: churnRisk
            };
        }).sort((a, b) => b.total_revenue - a.total_revenue);
    }

    /**
     * Get advanced intelligence for a specific customer
     * (Churn Risk, Next Purchase, Health Score)
     */
    async getCustomerIntelligence(customerId, organizationId) {
        if (!customerId || !organizationId) throw new Error('Customer/Org ID required');

        const { data: invoices, error } = await supabase
            .from('invoices')
            .select('*')
            .eq('customer_id', customerId)
            .eq('organization_id', organizationId)
            .order('createdAt', { ascending: true });

        if (error) throw new Error(error.message);

        const totalInvoices = invoices.length;
        const totalRevenue = invoices.reduce((acc, inv) => acc + (inv.total || 0), 0);
        const lastInvoice = invoices.length > 0 ? invoices[invoices.length - 1] : null;
        const lastTransactionDate = lastInvoice ? lastInvoice.createdAt : null;

        const breakdown = {
            paid: invoices.filter(i => i.status === 'paid').length,
            pending: invoices.filter(i => i.status === 'pending').length,
            overdue: invoices.filter(i => i.status === 'pending' && new Date(i.dueDate) < new Date()).length,
            draft: invoices.filter(i => i.status === 'draft').length,
        };

        // 1. Recurrence Math
        const intervals = invoices
            .map((inv, i, arr) => i > 0 ? (new Date(inv.createdAt).getTime() - new Date(arr[i-1].createdAt).getTime()) / (1000 * 60 * 60 * 24) : null)
            .filter(d => d !== null);

        const avgInterval = intervals.length > 0 
            ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) 
            : CUSTOMER_HEALTH.DEFAULT_AVG_INTERVAL_DAYS;

        // 2. Churn Risk %
        let churnRisk = 0;
        if (lastTransactionDate) {
            const daysSinceLast = (new Date().getTime() - new Date(lastTransactionDate).getTime()) / (1000 * 60 * 60 * 24);
            churnRisk = Math.min(100, Math.round((daysSinceLast / (avgInterval * 3)) * 100));
            if (breakdown.overdue > 0) churnRisk = Math.min(100, churnRisk + 25);
        }

        // 3. Next Purchase Prediction
        let nextPurchase = "Insufficient data";
        if (lastTransactionDate && totalInvoices >= 2) {
            const nextDate = new Date(new Date(lastTransactionDate).getTime() + (avgInterval * 24 * 60 * 60 * 1000));
            const diff = Math.round((nextDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            if (diff < 0) nextPurchase = `Overdue by ${Math.abs(diff)} days`;
            else if (diff === 0) nextPurchase = "Expected today";
            else nextPurchase = `Expected in ~${diff} days`;
        }

        // 4. Health Score Logic
        let healthScore = CUSTOMER_HEALTH.BASELINE;
        if (totalInvoices > CUSTOMER_HEALTH.INVOICE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.INVOICE_BONUS;
        if (totalRevenue > CUSTOMER_HEALTH.REVENUE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.REVENUE_BONUS;
        if (breakdown.overdue > 0) healthScore -= CUSTOMER_HEALTH.OVERDUE_PENALTY;
        healthScore -= (churnRisk / 5);

        let healthLabel = 'Regular';
        if (healthScore >= CUSTOMER_HEALTH.VIP_THRESHOLD) healthLabel = 'VIP';
        else if (healthScore >= CUSTOMER_HEALTH.ACTIVE_THRESHOLD) healthLabel = 'Active';
        else if (healthScore < CUSTOMER_HEALTH.AT_RISK_THRESHOLD) healthLabel = 'At Risk';
        if (totalInvoices === 0) healthLabel = 'New';

        // 5. Recommended Action
        let recommendedAction = "Continue regular engagement.";
        if (churnRisk > CUSTOMER_HEALTH.CRITICAL_RISK_THRESHOLD) recommendedAction = "CRITICAL: Schedule retention call.";
        else if (churnRisk > CUSTOMER_HEALTH.MODERATE_RISK_THRESHOLD) recommendedAction = "MODERATE RISK: Send a check-in email.";
        else if (breakdown.overdue > 0) recommendedAction = "Follow-up on overdue payments.";

        return {
            totalInvoices,
            totalRevenue,
            lastTransactionDate,
            invoiceStatusBreakdown: breakdown,
            healthScore: Math.min(100, Math.max(0, Math.round(healthScore))),
            healthLabel,
            churnRisk,
            nextPurchase,
            recommendedAction,
            avgInterval
        };
    }

    /**
     * Get product performance metrics (DEPRECATED - Inventory Removed)
     */
    async getProductPerformance(organizationId) {
        return [];
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
            .select('status, total, createdAt, dueDate')
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
            } else if (inv.status === 'pending') {
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
            .select('id, status, total, dueDate')
            .eq('organization_id', organizationId);

        if (invError) throw new Error(invError.message);

        const { count: customerCount, error: custError } = await supabase
            .from('customers')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', organizationId);
        if (custError) throw new Error(custError.message);

        const { data: expenses, error: expError } = await supabase
            .from('expenses')
            .select('amount')
            .eq('organization_id', organizationId);
        if (expError) throw new Error(expError.message);

        const totalExpenses = expenses?.reduce((sum, exp) => sum + (exp.amount || 0), 0) || 0;




        const stats = {
            total_invoices: 0,
            paid_invoices: 0,
            pending_invoices: 0,
            draft_invoices: 0,
            overdue_invoices: 0,
            total_revenue: 0,
            pending_payments: 0,
            overdue_revenue: 0,
            total_customers: customerCount || 0,
            total_clients: customerCount || 0, // Explicitly named for AI clarity
        };

        invoices.forEach(inv => {
            stats.total_invoices++;

            if (inv.status === 'paid') {
                stats.paid_invoices++;
                stats.total_revenue += inv.total;
            } else if (inv.status === 'pending') {
                stats.pending_invoices++;
                stats.pending_payments += inv.total;
                const isOverdue = new Date(inv.dueDate) < new Date();
                if (isOverdue) {
                    stats.overdue_invoices++;
                    stats.overdue_revenue += inv.total;
                }
            } else if (inv.status === 'draft') {
                stats.draft_invoices++;
            }
        });

        stats.total_expenses = totalExpenses;

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
                return ''; // Inventory removed

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


        return {
            score: Math.max(0, Math.min(100, Math.round(score))),
            factors: {
                revenue: Math.round(revenueScore),
                overdue: Math.round(-overdueRatio * HEALTH_SCORE.OVERDUE_MAX_PENALTY),
                cashFlow: cashFlow.cash_flow_health === 'positive' ? HEALTH_SCORE.CASH_FLOW_MAX_BONUS : (HEALTH_SCORE.CASH_FLOW_MAX_BONUS / 2),
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
            .eq('status', 'pending')
            .lt('dueDate', new Date().toISOString());

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

                const active = agencyInvoices?.filter(i => i.status === 'pending').length || 0;

                stats.metrics = {
                    activeProjects: active,
                    projectHealth: PLACEHOLDERS.SERVICES_PROJECT_HEALTH, // Placeholder
                    pipelineValue: agencyInvoices?.reduce((sum, i) => sum + (i.status === 'draft' ? i.total : 0), 0) || 0
                };
                break;

            case 'ecommerce':
                const { count: dailyOrders } = await supabase
                    .from('invoices')
                    .select('*', { count: 'exact', head: true })
                    .eq('organization_id', organizationId)
                    .gte('createdAt', new Date(now.setHours(0, 0, 0, 0)).toISOString());

                stats.metrics = {
                    dailyOrders: dailyOrders || 0,
                    netMargins: PLACEHOLDERS.ECOMMERCE_NET_MARGINS
                };
                break;
        }

        return stats;
    }
}

export default new AnalyticsService();
