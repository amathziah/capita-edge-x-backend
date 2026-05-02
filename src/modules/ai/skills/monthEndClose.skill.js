/**
 * Month-End Close Skill
 *
 * Pulls the four pillars (revenue, expenses, AR, compliance) and synthesises
 * a one-page month-end summary. Read-only — no approval gate. The agentic
 * value is in the cross-domain joins and the LLM-written narrative tied to
 * the live numbers.
 */

const SKILL_ID = 'month_end_close';

async function plan() {
    return {
        skillId: SKILL_ID,
        label: 'Month-End Close',
        description: 'Cross-domain monthly summary: revenue, expenses, receivables, compliance, and a written narrative.',
        rationale: 'Tally gives you reports. We give you the explanation, written against live numbers.',
        domain: null,
        steps: [
            { id: 'gather_dashboard', kind: 'tool', label: 'Pull dashboard snapshot', tool: 'get_dashboard_snapshot', args: {}, status: 'pending' },
            { id: 'gather_payments', kind: 'tool', label: 'Pull this-month payments', tool: 'get_payment_workspace', args: {}, status: 'pending' },
            { id: 'gather_expenses', kind: 'tool', label: 'Pull this-month expenses', tool: 'get_expense_workspace', args: {}, status: 'pending' },
            { id: 'gather_invoices', kind: 'tool', label: 'Pull receivables', tool: 'get_invoice_workspace', args: {}, status: 'pending' },
            { id: 'gather_compliance', kind: 'tool', label: 'Pull compliance deadlines', tool: 'get_upcoming_deadlines', args: {}, status: 'pending' },
            { id: 'synthesise', kind: 'llm', label: 'Write the one-page narrative', dependsOn: ['gather_dashboard', 'gather_payments', 'gather_expenses', 'gather_invoices', 'gather_compliance'], status: 'pending' }
        ],
        meta: { createdAt: new Date().toISOString() }
    };
}

async function execute(plan, context = {}, runners = {}) {
    const { callTool, callLLM } = runners;
    const updated = [...plan.steps];

    const toolSteps = updated.filter(s => s.kind === 'tool');
    const results = await Promise.all(toolSteps.map(s => callTool(s.tool, s.args || {}, context)));

    toolSteps.forEach((step, i) => {
        const idx = updated.findIndex(s => s.id === step.id);
        updated[idx] = {
            ...updated[idx],
            status: results[i].ok ? 'completed' : 'failed',
            result: results[i].ok ? results[i].data : null,
            error: results[i].ok ? null : results[i].error
        };
    });

    const compact = {
        dashboard: _compactDashboard(updated.find(s => s.id === 'gather_dashboard')?.result),
        payments: _compactPayments(updated.find(s => s.id === 'gather_payments')?.result),
        expenses: _compactExpenses(updated.find(s => s.id === 'gather_expenses')?.result),
        invoices: _compactInvoices(updated.find(s => s.id === 'gather_invoices')?.result),
        compliance: _compactCompliance(updated.find(s => s.id === 'gather_compliance')?.result)
    };

    const synthIdx = updated.findIndex(s => s.id === 'synthesise');
    let narrative = '';

    if (callLLM) {
        const currency = context.currency || '';
        const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const prompt = `Write a one-page month-end close summary for ${today}.
Currency: ${currency}.
Use ONLY the numbers below — do not invent any figures.

Data:
${JSON.stringify(compact, null, 2)}

Structure:
1. Headline (1 sentence): the bottom line — net position vs last month if available.
2. Revenue & collections (2 bullets max).
3. Spend (2 bullets max).
4. Receivables risk (2 bullets max).
5. Compliance deadlines (1 bullet, only if any are urgent).
6. One specific next action.

Tight markdown. No filler.`;

        try {
            narrative = await callLLM(prompt, { maxTokens: 800, temperature: 0.3 });
        } catch (err) {
            narrative = _fallbackNarrative(compact, context);
        }
    } else {
        narrative = _fallbackNarrative(compact, context);
    }

    updated[synthIdx] = { ...updated[synthIdx], status: 'completed', result: { narrative } };

    return {
        skillId: SKILL_ID,
        status: 'completed',
        steps: updated,
        summary: 'Month-end close synthesised.',
        narrative,
        compact,
        requiresApproval: false
    };
}

function _compactDashboard(d) {
    if (!d) return null;
    return {
        revenue: d?.stats?.total_revenue,
        expenses: d?.stats?.total_expenses,
        netProfit: d?.stats?.net_profit,
        margin: d?.stats?.profit_margin,
        cashOnHand: d?.safeToSpend?.cashOnHand,
        safeToSpend: d?.safeToSpend?.safeToSpend
    };
}
function _compactPayments(d) { return d?.summary || null; }
function _compactExpenses(d) {
    return {
        summary: d?.summary || null,
        topCategories: (d?.topCategories || []).slice(0, 3)
    };
}
function _compactInvoices(d) { return d?.summary || null; }
function _compactCompliance(d) {
    return { upcoming: (d?.upcoming || []).slice(0, 5), overdue: d?.overdueCount, dueThisWeek: d?.dueThisWeek };
}

function _fallbackNarrative(c, context) {
    const currency = context.currency || '';
    const fmt = (n) => `${currency} ${Math.round(Number(n) || 0).toLocaleString()}`;
    const lines = [];
    lines.push(`**Month-end snapshot**`);
    if (c.dashboard) lines.push(`- Revenue ${fmt(c.dashboard.revenue)}, expenses ${fmt(c.dashboard.expenses)}, net ${fmt(c.dashboard.netProfit)}.`);
    if (c.invoices?.overdueAmount) lines.push(`- ${c.invoices.overdueCount || 0} overdue invoices worth ${fmt(c.invoices.overdueAmount)}.`);
    if (c.compliance?.dueThisWeek) lines.push(`- ${c.compliance.dueThisWeek} compliance items due this week.`);
    return lines.join('\n');
}

export default {
    id: SKILL_ID,
    label: 'Month-End Close',
    trigger: 'User wants a monthly summary, month-end close, or end-of-month report across all domains.',
    domain: null,
    destructive: false,
    plan,
    execute
};
