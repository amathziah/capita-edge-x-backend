import { supabase } from '../../core/database/supabase.js';
import { APIError } from '../../core/middleware/errorHandler.js';
import { parsePagination } from '../../core/utils/pagination.js';
import { CUSTOMER_HEALTH } from '../../core/config/constants.js';

export const getCustomers = async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);

    const { data: customers, error, count } = await supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('organization_id', req.user.organizationId) // Tenant isolation
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    
    res.setHeader('X-Total-Count', count || 0);
    res.json(customers);
};

export const createCustomer = async (req, res) => {
    const { id, name, email, phone, address, taxId, currency } = req.body;

    // Check for existing email if provided
    if (email) {
        const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('email', email)
            .eq('organization_id', req.user.organizationId)
            .single();

        if (existing && existing.id !== id) {
            throw new APIError('Customer with this email already exists', 400);
        }
    }

    if (id) {
        // Update
        const { error } = await supabase
            .from('customers')
            .update({
                name,
                email,
                phone,
                address,
                taxId, // Corrected from tax_id
                updatedAt: new Date() // Corrected from updatedAt: new Date() (wait, schema is updatedAt)
            })
            .eq('id', id)
            .eq('organization_id', req.user.organizationId);

        if (error) {
            console.error('Error updating customer:', error);
            throw new Error(error.message);
        }
        res.json({ success: true, id });
    } else {
        // Create
        const { data, error } = await supabase
            .from('customers')
            .insert([{
                name,
                email,
                phone,
                address,
                taxId, // Corrected from tax_id
                organization_id: req.user.organizationId,
                user_id: req.user.id
            }])
            .select()
            .single();

        if (error) {
            console.error('Error creating customer:', error);
            throw new Error(error.message);
        }
        res.json({ success: true, id: data.id });
    }
};

export const getCustomerById = async (req, res) => {
    const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !customer) throw new APIError('Customer not found', 404);
    res.json(customer);
};

export const deleteCustomer = async (req, res) => {
    const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organizationId);

    if (error) throw new APIError(error.message, 500);
    res.json({ success: true });
};

export const getCustomerInvoices = async (req, res) => {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select(`
            *,
            items: invoice_items (*)
        `)
        .eq('customer_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: false });

    if (error) throw new APIError(error.message, 500);
    res.json(invoices);
};

export const getCustomerInsights = async (req, res) => {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('customer_id', req.params.id)
        .eq('organization_id', req.user.organizationId)
        .order('createdAt', { ascending: true }); // Ascending for interval math

    if (error) throw new APIError(error.message, 500);

    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce((acc, inv) => acc + (inv.total || 0), 0);
    const lastInvoice = invoices.length > 0 ? invoices[invoices.length - 1] : null;
    const lastTransactionDate = lastInvoice ? lastInvoice.createdAt : null;

    const breakdown = {
        paid: invoices.filter(i => i.status === 'paid').length,
        pending: invoices.filter(i => i.status === 'pending').length,
        overdue: invoices.filter(i => i.status === 'overdue').length,
        draft: invoices.filter(i => i.status === 'draft').length,
    };

    // ─── Mathematical Intelligence ──────────────────────────────────────────
    
    // 1. Recurrence/Interval Math
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
        // Risk scales linearly: 0% at next expected date, 100% at 3x interval
        churnRisk = Math.min(100, Math.round((daysSinceLast / (avgInterval * 3)) * 100));
        
        // Overdue penalty
        if (breakdown.overdue > 0) churnRisk = Math.min(100, churnRisk + 25);
    } else {
        churnRisk = 0; // New customer
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

    // 4. Recommended Action
    let recommendedAction = "Continue regular engagement.";
    if (churnRisk > CUSTOMER_HEALTH.CRITICAL_RISK_THRESHOLD) {
        recommendedAction = "CRITICAL: Schedule a retention call immediately and offer a loyalty discount.";
    } else if (churnRisk > CUSTOMER_HEALTH.MODERATE_RISK_THRESHOLD) {
        recommendedAction = "MODERATE RISK: Send a personalized check-in email or new offer.";
    } else if (breakdown.overdue > 0) {
        recommendedAction = "Payment Reminder: Send a friendly nudge for overdue invoices.";
    } else if (totalInvoices > CUSTOMER_HEALTH.INVOICE_BONUS_THRESHOLD) {
        recommendedAction = "VIP Care: Send a thank you note or exclusive preview.";
    }

    // 5. Health Score Logic (Legacy preserved but refined)
    let healthScore = CUSTOMER_HEALTH.BASELINE;
    if (totalInvoices > CUSTOMER_HEALTH.INVOICE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.INVOICE_BONUS;
    if (totalRevenue > CUSTOMER_HEALTH.REVENUE_BONUS_THRESHOLD) healthScore += CUSTOMER_HEALTH.REVENUE_BONUS;
    if (breakdown.overdue > 0) healthScore -= CUSTOMER_HEALTH.OVERDUE_PENALTY;
    healthScore -= (churnRisk / 5); // Churn weight

    let healthLabel = 'Regular';
    if (healthScore >= CUSTOMER_HEALTH.VIP_THRESHOLD) healthLabel = 'VIP';
    else if (healthScore >= CUSTOMER_HEALTH.ACTIVE_THRESHOLD) healthLabel = 'Active';
    else if (healthScore < CUSTOMER_HEALTH.AT_RISK_THRESHOLD) healthLabel = 'At Risk';
    if (totalInvoices === 0) healthLabel = 'New';

    res.json({
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
    });
};
