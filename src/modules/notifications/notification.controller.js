import { supabase } from '../../core/database/supabase.js';
import { LIMITS } from '../../core/config/constants.js';

export const getNotifications = async (req, res) => {
    const notifications = [];
    const now = new Date();

    // 1. Overdue invoices
    const { data: overdueInvoices } = await supabase
        .from('invoices')
        .select('id, invoiceNumber, total, dueDate, buyer')
        .eq('organization_id', req.user.organizationId)
        .in('status', ['overdue', 'sent', 'viewed'])
        .lt('dueDate', now.toISOString());

    if (overdueInvoices) {
        overdueInvoices.forEach(inv => {
            const daysOverdue = Math.floor((now - new Date(inv.dueDate)) / (1000 * 60 * 60 * 24));
            notifications.push({
                id: `overdue-${inv.id}`,
                type: 'warning',
                text: `Invoice #${inv.invoiceNumber} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`,
                details: `₹${inv.total?.toLocaleString()} from ${inv.buyer?.name || 'Unknown'}`,
                time: inv.dueDate,
                actionUrl: '/invoices'
            });
        });
    }

    // 3. Recent payments
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentPayments } = await supabase
        .from('payments')
        .select('id, amount, method, createdAt')
        .eq('organization_id', req.user.organizationId)
        .gte('createdAt', yesterday)
        .order('createdAt', { ascending: false })
        .limit(5);

    if (recentPayments) {
        recentPayments.forEach(payment => {
            notifications.push({
                id: `payment-${payment.id}`,
                type: 'success',
                text: `Payment received: ₹${payment.amount?.toLocaleString()}`,
                details: `Via ${payment.method || 'Unknown'}`,
                time: payment.createdAt,
                actionUrl: '/payments'
            });
        });
    }

    // 4. Compliance due soon
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: upcomingCompliance } = await supabase
        .from('compliance_tasks')
        .select('id, type, due_date, priority')
        .eq('organization_id', req.user.organizationId)
        .eq('status', 'pending')
        .lte('due_date', weekFromNow)
        .order('due_date', { ascending: true })
        .limit(LIMITS.MAX_COMPLIANCE_NOTIFICATIONS);

    if (upcomingCompliance) {
        upcomingCompliance.forEach(task => {
            const dueDate = new Date(task.due_date);
            const daysUntil = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
            notifications.push({
                id: `compliance-${task.id}`,
                type: daysUntil <= 2 ? 'danger' : 'info',
                text: `${task.type} due ${daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`}`,
                details: task.priority === 'critical' ? 'Critical priority' : '',
                time: task.due_date,
                actionUrl: '/compliance'
            });
        });
    }

    // Sort
    const priorityOrder = { danger: 0, warning: 1, info: 2, success: 3 };
    notifications.sort((a, b) => {
        const priorityDiff = priorityOrder[a.type] - priorityOrder[b.type];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.time) - new Date(a.time);
    });

    res.json(notifications.slice(0, LIMITS.MAX_NOTIFICATIONS));
};
