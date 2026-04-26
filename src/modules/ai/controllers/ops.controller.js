import { supabase } from '../../../core/database/supabase.js';
import aiService from '../core/ai.service.js';
import aiTraceService from '../infra/trace.service.js';
import aiActionExecutorService from '../actions/executor.service.js';
import emailService from '../../../core/services/email.service.js';
import { APIError } from '../../../core/middleware/errorHandler.js';
import {
    AI_ACCESS_EXHAUSTED_MESSAGE,
    calculateAICost,
    checkAICreditLimit,
    getOrganizationSettings
} from './shared.js';

export const negotiateSettlement = async (req, res) => {
    const invoiceId = req.body?.invoiceId || req.body?.id;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: 'AI access unavailable',
            is_limit_reached: true,
            text: AI_ACCESS_EXHAUSTED_MESSAGE,
            provider: 'system:billing_gate'
        });
    }

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select('*, customers(name, email)')
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    const offer = await aiService.generateSettlementOffer(invoice);
    const { tokens, cost } = calculateAICost(offer?.usage, 'gemini-2.5-flash');

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        customer_id: invoice.customer_id,
        model_name: 'gemini-2.5-flash',
        total_tokens: tokens,
        cost
    }]);

    res.json(offer);
};

export const processCommand = async (req, res) => {
    const { command } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: 'AI access unavailable',
            is_limit_reached: true,
            text: AI_ACCESS_EXHAUSTED_MESSAGE,
            provider: 'system:billing_gate'
        });
    }

    if (!command) throw new APIError('Command text required', 400);

    const action = await aiService.parseCommand(command);
    const { tokens, cost } = calculateAICost(action.usage, 'gemini-2.5-flash');

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        model_name: 'gemini-2.5-flash',
        total_tokens: tokens,
        cost
    }]);

    res.json(action);
};

export const generateCollectionDraft = async (req, res) => {
    const { invoiceId, forceAggressive } = req.body;

    const creditStatus = await checkAICreditLimit(req);
    if (!creditStatus.allowed) {
        return res.json({
            error: 'AI access unavailable',
            is_limit_reached: true,
            text: AI_ACCESS_EXHAUSTED_MESSAGE,
            provider: 'system:billing_gate'
        });
    }

    const { data: invoice, error } = await supabase
        .from('invoices')
        .select(`
            *,
            customers (name, email)
        `)
        .eq('id', invoiceId)
        .eq('organization_id', req.user.organizationId)
        .single();

    if (error || !invoice) throw new APIError('Invoice not found', 404);

    const draft = await aiService.generateCollectionDraft(invoice, 'INR', forceAggressive);
    const { tokens, cost } = calculateAICost(draft.usage, 'gemini-2.5-flash');

    await supabase.from('ai_requests').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        customer_id: invoice.customer_id,
        model_name: 'gemini-2.5-flash',
        total_tokens: tokens,
        cost
    }]);

    res.json(draft);
};

export const sendCollectionReminder = async (req, res) => {
    const { invoiceId, subject, body } = req.body;

    const [
        { data: invoice, error: invError },
        settingsBundle
    ] = await Promise.all([
        supabase.from('invoices').select('*, customers(email, name)').eq('id', invoiceId).eq('organization_id', req.user.organizationId).single(),
        getOrganizationSettings(req.user.organizationId)
    ]);

    if (invError || !invoice) throw new APIError('Invoice not found', 404);

    const recipientEmail = invoice.customers?.email;
    if (!recipientEmail) throw new APIError('Customer email not found', 400);

    const htmlBody = body.replace(/\n/g, '<br/>');
    await emailService.sendCustomEmail(
        recipientEmail,
        subject,
        `<html><body>${htmlBody}</body></html>`,
        settingsBundle?.raw || {}
    );

    await supabase.from('notifications').insert([{
        organization_id: req.user.organizationId,
        user_id: req.user.id,
        type: 'reminder_sent',
        message: `AI Collection reminder sent to ${invoice.customers.name} for Invoice #${invoice.invoiceNumber}`,
        metadata: { invoiceId, subject }
    }]);

    res.json({ success: true, sentAt: new Date().toISOString() });
};

export const getBudget = async (req, res) => {
    const userId = req.user?.id || 'anon';
    const orgId = req.user?.organizationId;
    const budget = await aiService.getBudgetStatus(userId, orgId);
    res.json(budget);
};

export const getTraces = async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const traces = await aiTraceService.listByOrganization(req.user.organizationId, limit);
    res.json(traces);
};

export const getTraceById = async (req, res) => {
    const records = await aiTraceService.getTrace(req.params.traceId, req.user.organizationId);
    res.json(records);
};

export const executeAction = async (req, res) => {
    const action = req.body?.action;
    if (!action?.type) throw new APIError('Action type is required', 400);

    const traceId = action?.data?.traceHint || null;
    const result = await aiActionExecutorService.execute(action, {
        organizationId: req.user.organizationId,
        user: req.user
    });

    if (traceId) {
        await aiTraceService.log({
            traceId,
            organizationId: req.user.organizationId,
            userId: req.user.id,
            stage: 'final',
            toolId: `action:${action.type}`,
            query: null,
            input: { action },
            output: result
        });
    }

    res.json({
        success: true,
        action: action.type,
        result
    });
};
