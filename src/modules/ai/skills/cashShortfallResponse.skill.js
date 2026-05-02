/**
 * Cash Shortfall Response Skill
 *
 * When the user asks "can I afford X" / "will I run out of cash" / "should I
 * make this payment", this skill chains the predictor → the receivables it
 * can convert → the expenses it could defer → a recommended sequence of
 * actions. The output is decision-ready, not just data.
 */

const SKILL_ID = 'cash_shortfall_response';

async function plan() {
    return {
        skillId: SKILL_ID,
        label: 'Cash Shortfall Response',
        description: 'Predict 30-day cash position, then propose a concrete sequence of collections + spend deferrals to close any gap.',
        rationale: 'Salesforce predicts. We tell you what to do about it, against your live AR and spend.',
        domain: null,
        steps: [
            { id: 'predict', kind: 'tool', label: 'Predict 30-day cash position', tool: 'predict_cash_shortfall', args: {}, status: 'pending' },
            { id: 'overdue', kind: 'tool', label: 'List collectible receivables', tool: 'get_overdue_invoices', args: {}, dependsOn: ['predict'], status: 'pending' },
            { id: 'spend', kind: 'tool', label: 'Inspect biggest spend categories', tool: 'get_expense_category_breakdown', args: {}, dependsOn: ['predict'], status: 'pending' },
            { id: 'recommend', kind: 'llm', label: 'Recommend a closing sequence', dependsOn: ['predict', 'overdue', 'spend'], status: 'pending' }
        ],
        meta: { createdAt: new Date().toISOString() }
    };
}

async function execute(plan, context = {}, runners = {}) {
    const { callTool, callLLM } = runners;
    const updated = [...plan.steps];

    const predictRes = await callTool('predict_cash_shortfall', {}, context);
    _setStep(updated, 'predict', predictRes);

    const prediction = predictRes.ok ? predictRes.data : null;
    const isHealthy = prediction && !prediction.isShortfall && prediction.riskLevel === 'low';

    if (!predictRes.ok) {
        return { skillId: SKILL_ID, status: 'failed', steps: updated, summary: 'Could not run the cash predictor.', requiresApproval: false };
    }

    if (isHealthy) {
        // Skip the rest — short-circuit positive case.
        for (const id of ['overdue', 'spend', 'recommend']) {
            const idx = updated.findIndex(s => s.id === id);
            updated[idx] = { ...updated[idx], status: 'skipped' };
        }
        return {
            skillId: SKILL_ID,
            status: 'completed',
            steps: updated,
            summary: `Cash position is healthy for the next 30 days. Net cash projected: ${prediction.netCash30Days}.`,
            recommendation: prediction.recommendation,
            prediction,
            requiresApproval: false
        };
    }

    const [overdueRes, spendRes] = await Promise.all([
        callTool('get_overdue_invoices', {}, context),
        callTool('get_expense_category_breakdown', {}, context)
    ]);
    _setStep(updated, 'overdue', overdueRes);
    _setStep(updated, 'spend', spendRes);

    const overdueList = (overdueRes.ok ? (overdueRes.data?.overdue || overdueRes.data?.invoices || []) : []).slice(0, 5);
    const topCategories = (spendRes.ok ? (spendRes.data?.categories || []) : []).slice(0, 5);

    const recIdx = updated.findIndex(s => s.id === 'recommend');
    let recommendation = '';

    if (callLLM) {
        const currency = context.currency || '';
        const prompt = `Cash shortfall response. Use ONLY the numbers below.

Currency: ${currency}
Prediction: ${JSON.stringify(prediction)}
Top overdue receivables (collect these first): ${JSON.stringify(overdueList)}
Top spend categories (potential to defer): ${JSON.stringify(topCategories)}

Write a 4-step closing sequence ranked by impact and likelihood. For each step:
- The action (one line)
- The expected ${currency} impact
- Confidence (high/medium/low)

End with one sentence on whether the gap is closeable in 30 days.
Markdown bullets. No filler.`;

        try {
            recommendation = await callLLM(prompt, { maxTokens: 700, temperature: 0.3 });
        } catch {
            recommendation = _fallbackRecommendation(prediction, overdueList, topCategories, context);
        }
    } else {
        recommendation = _fallbackRecommendation(prediction, overdueList, topCategories, context);
    }

    updated[recIdx] = { ...updated[recIdx], status: 'completed', result: { recommendation } };

    return {
        skillId: SKILL_ID,
        status: 'completed',
        steps: updated,
        summary: prediction.isShortfall
            ? `Shortfall of ${prediction.shortfallAmount} predicted. Sequence below closes it.`
            : `Cash is tight (${prediction.riskLevel} risk). Sequence below buys headroom.`,
        recommendation,
        prediction,
        overdueList,
        topCategories,
        requiresApproval: false
    };
}

function _setStep(steps, id, result) {
    const idx = steps.findIndex(s => s.id === id);
    if (idx === -1) return;
    steps[idx] = {
        ...steps[idx],
        status: result.ok ? 'completed' : 'failed',
        result: result.ok ? result.data : null,
        error: result.ok ? null : result.error
    };
}

function _fallbackRecommendation(prediction, overdue, categories, context) {
    const currency = context.currency || '';
    const lines = ['**Closing sequence**'];
    if (overdue.length) lines.push(`- Chase top ${overdue.length} overdue invoices (≈ ${currency} ${Math.round(overdue.reduce((s, i) => s + (i.total || i.amount || 0), 0)).toLocaleString()}). High confidence.`);
    if (categories.length) lines.push(`- Defer or trim top spend category: ${categories[0]?.category || 'unknown'} (${currency} ${Math.round(categories[0]?.amount || 0).toLocaleString()}). Medium confidence.`);
    lines.push(`- Review pending invoices for early-payment discount offers. Medium confidence.`);
    lines.push(prediction.isShortfall ? `Gap: ${currency} ${prediction.shortfallAmount}. Closeable if collections move.` : `Headroom limited but stable.`);
    return lines.join('\n');
}

export default {
    id: SKILL_ID,
    label: 'Cash Shortfall Response',
    trigger: 'User asks about cash runway, "can I afford", "will I run out", or how to handle a tight cash month.',
    domain: null,
    destructive: false,
    plan,
    execute
};
