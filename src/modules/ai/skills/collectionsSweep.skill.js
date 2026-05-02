/**
 * Collections Sweep Skill
 *
 * The reference agentic skill: review every overdue invoice, look at each
 * customer's payment history, draft a personalised follow-up message, then
 * stop at an approval gate so the user reviews drafts before anything is
 * actually sent.
 *
 * This is what "agentic" means in practice for a finance assistant —
 * deterministic data gathering + LLM personalisation + human approval +
 * deterministic side-effects, all surfaced as one cohesive plan.
 */

const SKILL_ID = 'collections_sweep';

function _stepId(prefix, idx) {
    return `${prefix}_${idx}`;
}

async function plan(context = {}) {
    return {
        skillId: SKILL_ID,
        label: 'Collections Sweep',
        description: 'Review overdue invoices, build personalised follow-ups, and queue them for one-click approval.',
        rationale: 'Tally and Zoho list overdue invoices. We draft the follow-up too, tuned to each customer\'s history.',
        domain: 'invoices',
        steps: [
            { id: 'gather_overdue', kind: 'tool', label: 'Pull every overdue invoice', tool: 'get_overdue_invoices', args: {}, status: 'pending' },
            { id: 'gather_patterns', kind: 'tool', label: 'Score each customer\'s payment reliability', tool: 'get_payment_patterns', args: {}, dependsOn: ['gather_overdue'], status: 'pending' },
            { id: 'draft_followups', kind: 'llm', label: 'Draft a personalised follow-up per customer', dependsOn: ['gather_overdue', 'gather_patterns'], status: 'pending' },
            { id: 'approval_gate', kind: 'approval', label: 'You review each draft before send', dependsOn: ['draft_followups'], status: 'pending', approvalRequired: true },
            { id: 'send_reminders', kind: 'mutation', label: 'Send the approved reminders', tool: 'send_reminder', dependsOn: ['approval_gate'], status: 'pending', approvalRequired: true }
        ],
        meta: {
            createdAt: new Date().toISOString(),
            organizationId: context.organizationId || null
        }
    };
}

async function execute(plan, context = {}, runners = {}) {
    const { callTool, callLLM } = runners;
    const updatedSteps = [...plan.steps];

    // Step 1: pull overdue
    const overdueIdx = updatedSteps.findIndex(s => s.id === 'gather_overdue');
    const overdueResult = await callTool('get_overdue_invoices', {}, context);
    updatedSteps[overdueIdx] = {
        ...updatedSteps[overdueIdx],
        status: overdueResult.ok ? 'completed' : 'failed',
        result: overdueResult.ok ? overdueResult.data : null,
        error: overdueResult.ok ? null : overdueResult.error
    };

    if (!overdueResult.ok) {
        return _shortCircuit(plan, updatedSteps, 'Could not pull overdue invoices.');
    }

    const overdueInvoices = _extractInvoiceList(overdueResult.data);

    if (overdueInvoices.length === 0) {
        // Nothing to do — short-circuit cleanly.
        for (let i = overdueIdx + 1; i < updatedSteps.length; i++) {
            updatedSteps[i] = { ...updatedSteps[i], status: 'skipped' };
        }
        return {
            skillId: SKILL_ID,
            status: 'completed_empty',
            steps: updatedSteps,
            summary: 'No overdue invoices. Nothing to chase today.',
            drafts: [],
            requiresApproval: false
        };
    }

    // Step 2: payment patterns (parallel-friendly, but cheap to await sequentially)
    const patternsIdx = updatedSteps.findIndex(s => s.id === 'gather_patterns');
    const patternsResult = await callTool('get_payment_patterns', {}, context);
    updatedSteps[patternsIdx] = {
        ...updatedSteps[patternsIdx],
        status: patternsResult.ok ? 'completed' : 'failed',
        result: patternsResult.ok ? patternsResult.data : null,
        error: patternsResult.ok ? null : patternsResult.error
    };

    const patternByCustomer = _indexPatternsByCustomer(patternsResult.ok ? patternsResult.data : null);

    // Step 3: LLM-drafted personalised follow-ups (one batched call, cheaper)
    const draftIdx = updatedSteps.findIndex(s => s.id === 'draft_followups');
    const drafts = await _generateDrafts(overdueInvoices, patternByCustomer, callLLM, context);
    updatedSteps[draftIdx] = {
        ...updatedSteps[draftIdx],
        status: drafts.length > 0 ? 'completed' : 'failed',
        result: { drafts }
    };

    // Step 4: approval gate — pause here.
    const approvalIdx = updatedSteps.findIndex(s => s.id === 'approval_gate');
    updatedSteps[approvalIdx] = {
        ...updatedSteps[approvalIdx],
        status: 'awaiting_approval'
    };

    // Step 5: stays pending until user approves.
    return {
        skillId: SKILL_ID,
        status: 'awaiting_approval',
        steps: updatedSteps,
        summary: _summarise(overdueInvoices, drafts),
        drafts,
        requiresApproval: true
    };
}

function _extractInvoiceList(data) {
    if (!data) return [];
    if (Array.isArray(data?.overdue)) return data.overdue;
    if (Array.isArray(data?.invoices)) return data.invoices;
    if (Array.isArray(data?.overdueInvoices)) return data.overdueInvoices;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
}

function _indexPatternsByCustomer(patternsData) {
    const map = new Map();
    const list = patternsData?.patterns || [];
    for (const p of list) {
        if (p?.customerId) map.set(String(p.customerId), p);
        if (p?.name) map.set(String(p.name).toLowerCase(), p);
    }
    return map;
}

async function _generateDrafts(invoices, patternByCustomer, callLLM, context) {
    if (!callLLM) return _fallbackDrafts(invoices, patternByCustomer);

    // Cap at 10 to keep the prompt small and the human review tractable.
    const targets = invoices.slice(0, 10).map((inv) => {
        const customerId = String(inv.customer_id || inv.customerId || '');
        const customerName = inv?.buyer?.name || inv?.customerName || inv?.customer?.name || 'there';
        const pattern = patternByCustomer.get(customerId) || patternByCustomer.get(String(customerName).toLowerCase()) || null;
        return {
            invoiceNumber: inv.invoiceNumber || inv.invoice_number || inv.id,
            customerName,
            amount: inv.total || inv.amount || 0,
            dueDate: inv.dueDate || inv.due_date,
            daysOverdue: inv.daysOverdue || inv.days_overdue || _computeDaysOverdue(inv.dueDate || inv.due_date),
            reliability: pattern?.reliability || 'unknown'
        };
    });

    const currency = context.currency || context.settings?.currency || '';
    const businessName = context.businessName || context.settings?.business_name || 'us';

    const prompt = `Draft a short, professional follow-up message for each overdue invoice below.
Tone: firm but friendly. Mention the invoice number, amount, and how many days overdue.
Adjust based on reliability:
  - "reliable": warm, assume oversight, soft ask for status
  - "slow" / "irregular": direct, propose payment plan or partial
  - "unknown": neutral, ask for confirmation
Keep each message ≤ 4 sentences. Sender is ${businessName}.

Invoices:
${JSON.stringify(targets, null, 2)}

Reply with ONLY a JSON array, one object per invoice, no markdown:
[{"invoiceNumber":"...","customerName":"...","amount":0,"daysOverdue":0,"reliability":"...","message":"...","subject":"..."}]`;

    try {
        const text = await callLLM(prompt, { maxTokens: 1500, temperature: 0.5, json: true });
        const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
        const arr = JSON.parse(match ? match[0] : cleaned);
        if (!Array.isArray(arr)) return _fallbackDrafts(invoices, patternByCustomer);
        return arr.map((d, i) => ({
            ...targets[i],
            ...d,
            currency,
            id: `draft_${i}`
        }));
    } catch {
        return _fallbackDrafts(invoices, patternByCustomer, currency);
    }
}

function _fallbackDrafts(invoices, patternByCustomer, currency = '') {
    return invoices.slice(0, 10).map((inv, i) => {
        const customerName = inv?.buyer?.name || inv?.customerName || 'there';
        const invoiceNumber = inv.invoiceNumber || inv.invoice_number || inv.id;
        const amount = inv.total || inv.amount || 0;
        const daysOverdue = inv.daysOverdue || _computeDaysOverdue(inv.dueDate);
        return {
            id: `draft_${i}`,
            invoiceNumber,
            customerName,
            amount,
            currency,
            daysOverdue,
            reliability: 'unknown',
            subject: `Reminder: invoice ${invoiceNumber}`,
            message: `Hi ${customerName}, invoice ${invoiceNumber} (${currency} ${amount}) is ${daysOverdue} days overdue. Could you confirm a payment date? Happy to share the original invoice if helpful.`
        };
    });
}

function _computeDaysOverdue(dueDate) {
    if (!dueDate) return 0;
    const due = new Date(dueDate).getTime();
    if (!Number.isFinite(due)) return 0;
    return Math.max(0, Math.floor((Date.now() - due) / (24 * 3600 * 1000)));
}

function _summarise(invoices, drafts) {
    const total = invoices.reduce((s, i) => s + (Number(i.total) || Number(i.amount) || 0), 0);
    return `${drafts.length} drafts ready across ${Math.round(total).toLocaleString()} in overdue receivables. Review each below — nothing sends until you approve.`;
}

function _shortCircuit(plan, steps, summary) {
    return {
        skillId: SKILL_ID,
        status: 'failed',
        steps,
        summary,
        drafts: [],
        requiresApproval: false
    };
}

export default {
    id: SKILL_ID,
    label: 'Collections Sweep',
    trigger: 'User wants to chase, follow up on, or send reminders for overdue invoices/customers.',
    domain: 'invoices',
    destructive: true,
    plan,
    execute
};
