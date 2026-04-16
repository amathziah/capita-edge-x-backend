import { formatCurrency } from '../../../core/utils/formatting.js';

class AIGroundingService {
    getSpecialistInstructions(execution = {}) {
        const domain = execution.primaryDomain || 'finance';
        const specialistLabel = execution.specialistLabel || 'CFO';

        const domainInstruction = {
            invoices: 'You are Capita, an AI CFO focused on receivables. Your job is to tell the owner exactly which invoices are putting cash at risk, in what order to collect, and what to do today. Be direct. Do not list data passively — give a verdict and a specific next action. Name the debtor. State the amount. State the urgency.',
            payments: 'You are Capita, an AI CFO reviewing incoming cash. Tell the owner whether their collections are strong or weak, what came in recently, if anything expected is missing, and what reconciliation action is needed. Be specific — name amounts and dates.',
            expenses: 'You are Capita, an AI CFO reviewing spend. Tell the owner where the money is going, whether any category looks unusual or controllable, and what to cut or watch. Be direct and commercial — savings recommendations should be specific, not generic.',
            compliance: 'You are Capita, an AI CFO managing compliance risk. Lead with urgency — what is overdue, what is due this week, and what is the exact filing or task that needs to happen. Do not give generic advice. State deadlines and tasks by name.',
            finance: 'You are Capita, an AI CFO with full visibility of this business. Lead with the single most important financial fact, then give your verdict on business health, and end with the one action the owner must take next. Be opinionated. Synthesis beats summary.',
            customers: 'You are Capita, an AI CFO reviewing the customer portfolio. Tell the owner who their highest-value and highest-risk customers are, whether any payer is becoming a risk, and what the concentration risk looks like. Be direct and specific.',
            actions: 'You are Capita, an AI CFO helping the owner navigate the system. Be brief, direct, and action-oriented.',
            general: 'You are Capita, an AI CFO. Be direct, opinionated, and practical.'
        }[domain] || 'You are Capita, an AI CFO. Be direct, opinionated, and practical.';

        return { domain, specialistLabel, domainInstruction };
    }

    buildEvidencePrompt(query, context = {}, execution = {}) {
        const {
            settings = {},
            temporal = {},
            businessType,
        } = context;

        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const rawBusinessSegment = businessType || settings?.business_type || settings?.businessType || 'solopreneur';
        const businessSegment = rawBusinessSegment === 'freelancer' ? 'solopreneur' : rawBusinessSegment;

        const personaInstructions = {
            solopreneur: 'You are the trusted CFO for an Indian solopreneur or freelancer. You know that runway, collections, and tax compliance are survival issues — not nice-to-haves. Give answers that feel like advice from a financially savvy co-founder who cares about the business staying alive and growing.',
            subscription: 'You are the CFO for a SaaS business. MRR quality, churn risk, and cash predictability are paramount. Give answers that feel like advice from a CFO who understands recurring revenue models deeply.',
            services_firm: 'You are the CFO for a services firm. Utilisation, project margins, and receivables collection speed are what matter. Give answers that feel like advice from a CFO who has seen late-paying clients and tight margins before.',
            ecommerce: 'You are the CFO for a commerce business. Working capital, inventory cycle, and margins are the core levers. Give answers that feel like advice from a CFO who knows cash conversion cycles.'
        }[businessSegment] || 'You are Capita, an AI CFO. Give clear, direct financial advice grounded in the available data.';

        const evidenceLines = (execution.toolResults || []).map((entry, index) => {
            const payload = JSON.stringify({
                tool: entry.toolId,
                args: entry.args,
                data: entry.result?.data,
                meta: entry.result?.meta
            });
            return `TOOL_${index + 1}: ${payload}`;
        }).join('\n');

        const { domain, specialistLabel, domainInstruction } = this.getSpecialistInstructions(execution);

        const noToolRules = !evidenceLines ? [
            '- NO_TOOL_RESULTS: This query did not retrieve any live workspace data.',
            '- If the user is asking about their OWN invoices, payments, expenses, customers, or any private business figures (using "my", "our", "I have", "do I", etc.): say you need to retrieve their live data first and cannot answer without it.',
            '- Do NOT mention, estimate, or approximate any private business number (revenue, count, amount, name, date) that is not in TOOL results.',
            '- HOWEVER: If the question is general or educational (e.g. "what is GST?", "how does invoice factoring work?", "what are standard payment terms?", "explain TDS", "should I use net-30?"), answer it fully and helpfully as a knowledgeable CFO. No live data is needed for these.',
            '- You can answer any general finance, tax, accounting, or business question that does not require the user\'s private data.',
            '- When the user asks what you can do or what questions they can ask, respond naturally as Capita — describe your capabilities across invoices, payments, expenses, compliance, cash flow, business health, and customers. Provide example questions they can try.',
        ] : [];

        const hasMultipleTools = (execution.toolResults || []).length > 1;
        const crossToolInstruction = hasMultipleTools ? [
            '- CROSS-TOOL SYNTHESIS: You have data from multiple tools. Do not report each tool separately. Synthesize them into a single coherent answer.',
            '- Connect the dots: if invoices are high but payments are low, that is a collections problem. Say so.',
            '- If expenses exceed collections this period, flag that as a cash squeeze. Name the tension explicitly.',
            '- Your synthesis should surface insights that none of the individual tools could produce alone.',
        ] : [];

        return [
            'You are Capita, an AI Chief Financial Officer.',
            personaInstructions,
            domainInstruction,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Detected intent: ${execution.intent || 'general_advice'}`,
            `Primary domain: ${domain}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'YOUR RESPONSE STYLE — follow precisely:',
            '- Lead with the single most important insight as a confident statement. Not a summary. A verdict.',
            '- Follow with 2-4 supporting facts from tool evidence. Each one should be meaningful, not filler.',
            '- End with one specific, actionable next step. Not "review your invoices" — name the invoice. Not "check compliance" — name the task.',
            '- Use plain language. No jargon. No hedging unless legally required.',
            '- If something needs urgent attention, say "Urgent" or "Act today" — do not bury urgency in polite language.',
            '- If the situation is healthy, say so clearly: "No immediate issues" or "You are in a good position here."',
            '',
            'GROUNDING RULES — non-negotiable:',
            '- Every number, name, date, and status you cite must come from TOOL results. No exceptions.',
            '- If a fact is not in TOOL results, do not state it. Say it is not available.',
            '- Do not invent, infer, estimate, round, or re-derive any private business figure.',
            '- For GST, TDS, tax, legal, or compliance questions: state "Verify this against the latest official source before acting."',
            '- If the query requires private data and NO_TOOL_RESULTS: say "I need to pull your live [domain] data to answer this accurately."',
            ...noToolRules,
            ...crossToolInstruction,
            '',
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'Respond in markdown. Structure:',
            '1. One-sentence verdict (bold if urgent).',
            '2. 2-4 supporting bullets — each grounded in tool evidence.',
            '3. One specific next action starting with a strong verb ("Follow up on...", "File...", "Cut...", "Collect...").',
        ].join('\n');
    }

    buildGroundedJsonPrompt(query, context = {}, execution = {}) {
        const {
            settings = {},
            temporal = {},
            businessType,
        } = context;

        const currency = settings?.currency || context?.currency || 'INR';
        const businessName = settings?.business_name || settings?.businessName || 'your business';
        const rawBusinessSegment = businessType || settings?.business_type || settings?.businessType || 'solopreneur';
        const businessSegment = rawBusinessSegment === 'freelancer' ? 'solopreneur' : rawBusinessSegment;

        const personaInstructions = {
            solopreneur: 'You are the CFO for an Indian solopreneur. Collections, runway, and tax compliance are survival issues. Lead with what matters most.',
            subscription: 'You are the CFO for a SaaS business. MRR quality and churn are the core metrics. Lead with the signal that matters for recurring revenue health.',
            services_firm: 'You are the CFO for a services firm. Utilisation gaps and receivables risk are your primary concern. Lead with those.',
            ecommerce: 'You are the CFO for a commerce business. Working capital and margin are the levers. Lead with cash conversion.'
        }[businessSegment] || 'You are Capita, an AI CFO. Give clear, grounded financial verdicts.';

        const evidenceLines = (execution.toolResults || []).map((entry, index) => {
            const payload = JSON.stringify({
                tool: entry.toolId,
                args: entry.args,
                data: entry.result?.data,
                meta: entry.result?.meta
            });
            return `TOOL_${index + 1}: ${payload}`;
        }).join('\n');

        const { domain, specialistLabel, domainInstruction } = this.getSpecialistInstructions(execution);
        const hasMultipleTools = (execution.toolResults || []).length > 1;

        return [
            'You are Capita, an AI Chief Financial Officer.',
            personaInstructions,
            domainInstruction,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Detected intent: ${execution.intent || 'general_advice'}`,
            `Primary domain: ${domain}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'Return valid JSON only. No markdown, no preamble.',
            '',
            'CRITICAL GROUNDING RULES — violations will reject this response:',
            '- Every number, name, date, and status must come from TOOL results. Zero tolerance for invented data.',
            '- Never round, estimate, extrapolate, or re-derive any figure from the evidence.',
            '- If a fact is missing from TOOL results, set verification_status to "insufficient_evidence" and name exactly what is missing.',
            '- Every bullet must cite at least one tool from the evidence list.',
            '- Do not cite tools not present in Tool evidence.',
            '- Do not introduce business figures in next_action — that field is advice only.',
            '- For GST, TDS, tax, or legal questions: set verification_status to "requires_professional_review".',
            '- Never mention tool IDs in summary, bullets, or next_action.',
            '',
            'CFO RESPONSE STYLE:',
            '- summary: Write as a CFO verdict, not a data summary. Lead with the key signal. Be direct.',
            hasMultipleTools ? '- CROSS-TOOL: You have multiple data sources. Synthesize them. Surface the tension or alignment between them. Do not report each separately.' : '',
            '- bullets: Each bullet should be a meaningful insight, not just a data point restated. Connect facts to implications.',
            '- next_action: Give one specific, executable action. Not generic. Name invoices, deadlines, or categories where possible.',
            '',
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'JSON schema:',
            '{',
            '  "summary": "string — CFO verdict in one sentence. State the most important financial fact and its implication.",',
            '  "bullets": [{"text": "string — meaningful insight with implication, not just a data point", "citations": [{"tool": "tool_id_exactly_as_provided"}]}],',
            '  "next_action": "string — one specific executable action. Start with a strong verb. Name specifics where available.",',
            '  "citations": [{"tool": "tool_id_exactly_as_provided"}],',
            '  "verification_status": "grounded" | "insufficient_evidence" | "requires_professional_review"',
            '}'
        ].filter(Boolean).join('\n');
    }

    _normaliseClaimNumber(value) {
        if (value === null || value === undefined) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const cleaned = raw.replace(/,/g, '');
        const numeric = Number(cleaned.replace(/%$/, ''));
        if (!Number.isFinite(numeric)) return null;
        const suffix = cleaned.endsWith('%') ? '%' : '';
        return `${numeric}${suffix}`;
    }

    _extractClaimNumbers(text = '') {
        const matches = String(text).match(/\b\d[\d,]*(?:\.\d+)?%?\b/g) || [];
        return matches
            .map((value) => this._normaliseClaimNumber(value))
            .filter(Boolean);
    }

    _collectEvidenceFacts(value, accumulator = { numbers: new Set() }) {
        if (value === null || value === undefined) {
            return accumulator;
        }

        if (typeof value === 'number') {
            const normalised = this._normaliseClaimNumber(value);
            if (normalised) accumulator.numbers.add(normalised);
            return accumulator;
        }

        if (typeof value === 'string') {
            for (const numeric of this._extractClaimNumbers(value)) {
                accumulator.numbers.add(numeric);
            }
            return accumulator;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => this._collectEvidenceFacts(item, accumulator));
            return accumulator;
        }

        if (typeof value === 'object') {
            Object.values(value).forEach((item) => this._collectEvidenceFacts(item, accumulator));
        }

        return accumulator;
    }

    collectExecutionEvidence(execution = {}) {
        const toolIds = new Set();
        const numbers = new Set();

        for (const entry of execution.toolResults || []) {
            if (entry?.toolId) {
                toolIds.add(entry.toolId);
            }
            this._collectEvidenceFacts(entry?.result?.data, { numbers });
            this._collectEvidenceFacts(entry?.result?.meta, { numbers });
        }

        return {
            toolIds,
            numbers
        };
    }

    validateGroundedPayload(payload = {}, execution = {}, queryRisk = {}) {
        const issues = [];
        const evidence = this.collectExecutionEvidence(execution);
        const hasToolEvidence = Boolean((execution.toolResults || []).length);
        const citations = Array.isArray(payload.citations) ? payload.citations : [];
        const bullets = Array.isArray(payload.bullets) ? payload.bullets : [];

        if (!payload.summary || typeof payload.summary !== 'string') {
            issues.push('missing_summary');
        }

        if (!payload.next_action || typeof payload.next_action !== 'string') {
            issues.push('missing_next_action');
        }

        const citedTools = new Set();
        for (const citation of citations) {
            const toolId = citation?.tool;
            if (!toolId || !evidence.toolIds.has(toolId)) {
                issues.push('invalid_top_level_citation');
                continue;
            }
            citedTools.add(toolId);
        }

        for (const bullet of bullets) {
            if (!bullet?.text || typeof bullet.text !== 'string') {
                issues.push('invalid_bullet');
                continue;
            }

            const bulletCitations = Array.isArray(bullet.citations) ? bullet.citations : [];
            if (hasToolEvidence && bulletCitations.length === 0) {
                issues.push('uncited_bullet');
                continue;
            }

            for (const citation of bulletCitations) {
                const toolId = citation?.tool;
                if (!toolId || !evidence.toolIds.has(toolId)) {
                    issues.push('invalid_bullet_citation');
                    continue;
                }
                citedTools.add(toolId);
            }
        }

        if (hasToolEvidence && citedTools.size === 0) {
            issues.push('missing_citations');
        }

        const factualText = [
            payload.summary,
            ...bullets.map((bullet) => bullet?.text || '')
        ].join('\n');
        const unsupportedNumbers = this._extractClaimNumbers(factualText)
            .filter((number) => !evidence.numbers.has(number));

        if (hasToolEvidence && unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        const validStatuses = new Set(['grounded', 'insufficient_evidence', 'requires_professional_review']);
        if (!validStatuses.has(payload.verification_status)) {
            issues.push('invalid_verification_status');
        }

        if (queryRisk.highStakesDomain && payload.verification_status === 'grounded' && !hasToolEvidence) {
            issues.push('ungrounded_high_stakes_claim');
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    formatGroundedPayload(payload = {}) {
        const bulletLines = (payload.bullets || [])
            .filter((bullet) => bullet?.text)
            .map((bullet) => `- ${bullet.text}`);

        const nextAction = payload.next_action || 'Ask a narrower grounded question.';

        return [
            payload.summary || 'I do not have enough verified evidence to answer that.',
            bulletLines.length > 0 ? '' : null,
            bulletLines.length > 0 ? bulletLines.join('\n') : null,
            '',
            `**${nextAction}**`
        ].filter(line => line !== null).join('\n');
    }

    buildToolBackedFallbackAnswer(query = '', execution = {}) {
        const lowerQuery = String(query || '').toLowerCase();
        const normalizedQuery = lowerQuery.replace(/\bover\s+due\b/g, 'overdue');
        const sections = [];
        const nextActions = [];
        let dashboardSnapshot = null;
        let invoiceWorkspace = null;
        let paymentWorkspace = null;
        let expenseWorkspace = null;
        let complianceWorkspace = null;
        let recentActivity = null;
        let currency = 'INR';

        for (const entry of execution.toolResults || []) {
            const toolId = entry?.toolId;
            const data = entry?.result?.data || {};
            const currency = data?.currency || entry?.result?.meta?.currency || 'INR';

            if (toolId === 'get_business_advisor_context') {
                dashboardSnapshot = data.snapshot || dashboardSnapshot;
                recentActivity = data.recentActivity || recentActivity;
                invoiceWorkspace = data.invoices || invoiceWorkspace;
                paymentWorkspace = data.payments || paymentWorkspace;
                expenseWorkspace = data.expenses || expenseWorkspace;
                complianceWorkspace = data.compliance || complianceWorkspace;
            }

            if (toolId === 'get_dashboard_snapshot') dashboardSnapshot = data;
            if (toolId === 'get_invoice_workspace') invoiceWorkspace = data;
            if (toolId === 'get_payment_workspace') paymentWorkspace = data;
            if (toolId === 'get_expense_workspace') expenseWorkspace = data;
            if (toolId === 'get_compliance_workspace') complianceWorkspace = data;
            if (toolId === 'get_recent_activity') recentActivity = data;

            if (toolId === 'get_dashboard_snapshot') {
                const stats = data.stats || {};
                const safeToSpend = data.safeToSpend || {};
                const monthlyBurn = Number(safeToSpend.totalExpenses || stats.total_expenses || 0);
                const availableLiquidity = Number(safeToSpend.safeToSpend || 0);
                const estimatedRunwayMonths = monthlyBurn > 0
                    ? Number((availableLiquidity / monthlyBurn).toFixed(1))
                    : null;

                if (lowerQuery.includes('runway')) {
                    if (estimatedRunwayMonths === null) {
                        return [
                            'I can estimate runway only when there is a non-zero expense trend to compare against current safe-to-spend cash.',
                            '',
                            `Verified liquidity right now is ${formatCurrency(availableLiquidity, currency)}, but monthly burn is not high enough in the available data to compute a stable runway estimate.`,
                            '',
                            'Next action: review current expenses and cash reserves before using runway as a decision metric.'
                        ].join('\n');
                    }

                    return [
                        `Estimated cash runway is about ${estimatedRunwayMonths} months based on verified safe-to-spend liquidity of ${formatCurrency(availableLiquidity, currency)} and recorded expenses of ${formatCurrency(monthlyBurn, currency)} in the current trend window.`,
                        '',
                        `- Cash on hand: ${formatCurrency(safeToSpend.cashOnHand || 0, currency)}.`,
                        `- Protected reserves and risk buffers: ${formatCurrency((safeToSpend.reserves?.gst || 0) + (safeToSpend.reserves?.incomeTax || 0) + (safeToSpend.reserves?.atRisk || 0), currency)}.`,
                        '',
                        'Next action: treat this as an operating estimate and tighten collections if you want to extend runway.'
                    ].join('\n');
                }

                if (lowerQuery.includes('safe to spend') || lowerQuery.includes('cash flow') || lowerQuery.includes('cashflow')) {
                    return [
                        `Verified safe-to-spend cash is ${formatCurrency(availableLiquidity, currency)}.`,
                        '',
                        `- Cash on hand: ${formatCurrency(safeToSpend.cashOnHand || 0, currency)}.`,
                        `- Total recorded expenses: ${formatCurrency(monthlyBurn, currency)}.`,
                        `- Reserve buffer: ${formatCurrency((safeToSpend.reserves?.gst || 0) + (safeToSpend.reserves?.incomeTax || 0) + (safeToSpend.reserves?.atRisk || 0), currency)}.`,
                        '',
                        'Next action: preserve buffer for tax and overdue-risk reserves before committing new spend.'
                    ].join('\n');
                }
            }

            if (toolId === 'get_recent_activity' && (
                lowerQuery.includes('recent activity') ||
                lowerQuery.includes('what happened recently') ||
                lowerQuery.includes('latest activity')
            )) {
                const invoices = Array.isArray(data.invoices) ? data.invoices : [];
                const payments = Array.isArray(data.payments) ? data.payments : [];
                const expenses = Array.isArray(data.expenses) ? data.expenses : [];

                return [
                    'Recent business activity from your live data:',
                    '',
                    invoices.length > 0 ? `- Invoices: ${invoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : '- Invoices: no recent invoice activity found.',
                    payments.length > 0 ? `- Payments: ${payments.slice(0, 2).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : '- Payments: no recent payment activity found.',
                    expenses.length > 0 ? `- Expenses: ${expenses.slice(0, 2).map((expense) => `${expense.description || expense.category || 'expense'} (${formatCurrency(expense.amount || 0, currency)} on ${expense.date || 'unknown date'})`).join('; ')}.` : '- Expenses: no recent expense activity found.',
                    '',
                    'Next action: reconcile the most recent cash movements and confirm they match open invoices and planned spend.'
                ].join('\n');
            }

            if (toolId === 'get_invoice_workspace') {
                const summary = data.summary || {};
                const overdueInvoices = Array.isArray(data.overdueInvoices) ? data.overdueInvoices : [];
                const recentInvoices = Array.isArray(data.recentInvoices) ? data.recentInvoices : [];
                const topAttention = overdueInvoices.slice(0, 3)
                    .map((invoice) => `#${invoice.invoiceNumber} (${invoice.daysOverdue || 0} days overdue, ${formatCurrency(invoice.balanceDue || 0, currency)})`);

                if (
                    normalizedQuery.includes('how many overdue invoice') ||
                    normalizedQuery.includes('how many overdue invoices') ||
                    normalizedQuery.includes('number of overdue invoices') ||
                    normalizedQuery.includes('count of overdue invoices')
                ) {
                    return [
                        `You currently have ${summary.overdueCount || 0} overdue invoices totaling ${formatCurrency(summary.overdueAmount || 0, currency)}.`,
                        '',
                        topAttention.length > 0 ? `- Most urgent invoices: ${topAttention.join('; ')}.` : '- No specific overdue invoices were available in the current evidence set.',
                        '',
                        `Next action: ${topAttention.length > 0 ? `follow up first on ${topAttention[0].split(' ')[0]}` : 'review overdue invoices and send reminders.'}`
                    ].filter(Boolean).join('\n');
                }

                sections.push([
                    `Receivables needing action: ${summary.totalInvoices || 0} invoices tracked, ${formatCurrency(summary.totalOutstanding || 0, currency)} still outstanding, and ${formatCurrency(summary.overdueAmount || 0, currency)} already overdue.`,
                    topAttention.length > 0 ? `- Priority invoices: ${topAttention.join('; ')}.` : null,
                    recentInvoices.length > 0 ? `- Recent invoice activity: ${recentInvoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                if (topAttention.length > 0) {
                    nextActions.push(`follow up first on ${topAttention[0].split(' ')[0]}`);
                } else {
                    nextActions.push('review unpaid invoices and send reminders');
                }
            }

            if (toolId === 'get_payment_workspace') {
                const summary = data.summary || {};
                const recentPayments = Array.isArray(data.recentPayments) ? data.recentPayments : [];

                if (
                    lowerQuery.includes('recent payment') ||
                    lowerQuery.includes('recent payments') ||
                    lowerQuery.includes('payments came in') ||
                    lowerQuery.includes('payments received') ||
                    lowerQuery.includes('payments came through') ||
                    lowerQuery.includes('cash came in') ||
                    lowerQuery.includes('collections came in')
                ) {
                    const latest = recentPayments.slice(0, 3).map((payment) => {
                        const label = payment.reference_number || payment.method || payment.payment_mode || 'payment';
                        return `${label} (${formatCurrency(payment.amount || 0, currency)}${payment.date ? ` on ${payment.date}` : ''})`;
                    });

                    return [
                        `Recent incoming payments total ${formatCurrency(summary.totalCollected || 0, currency)} across ${summary.completedCount || 0} completed receipts.`,
                        '',
                        latest.length > 0 ? `- Latest receipts: ${latest.join('; ')}.` : '- No recent payment receipts were available in the current evidence set.',
                        '',
                        'Next action: reconcile these receipts against open invoices and mark any unmatched payments.'
                    ].join('\n');
                }

                if (lowerQuery.includes('how are you doing') || lowerQuery.includes('how is the business doing')) {
                    return [
                        `Payments show ${formatCurrency(summary.totalCollected || 0, currency)} collected and ${summary.pendingCount || 0} payment(s) still pending.`,
                        '',
                        recentPayments.length > 0 ? `- Latest payment activity: ${recentPayments.slice(0, 3).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)})`).join('; ')}.` : '- No recent payment activity available.',
                        '',
                        'Next action: compare receipts with overdue invoices and current cash balance.'
                    ].join('\n');
                }

                sections.push([
                    `Payments snapshot: ${summary.completedCount || 0} completed payments recorded, ${formatCurrency(summary.totalCollected || 0, currency)} collected overall, and ${formatCurrency(summary.collectedThisMonth || 0, currency)} collected this month.`,
                    recentPayments.length > 0 ? `- Recent receipts: ${recentPayments.slice(0, 3).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('reconcile the latest completed payments against open invoices');
            }

            if (toolId === 'get_expense_workspace') {
                const summary = data.summary || {};
                const topCategories = Array.isArray(data.topCategories) ? data.topCategories : [];

                sections.push([
                    `Expense snapshot: ${summary.totalExpenses || 0} expenses recorded, ${formatCurrency(summary.totalSpend || 0, currency)} total spend, and ${formatCurrency(summary.spendThisMonth || 0, currency)} spent this month.`,
                    topCategories.length > 0 ? `- Largest categories: ${topCategories.slice(0, 3).map((entry) => `${entry.category} (${formatCurrency(entry.amount || 0, currency)})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('review the highest spend categories for controllable costs');
            }

            if (toolId === 'get_compliance_workspace') {
                const summary = data.summary || {};
                const urgentTasks = Array.isArray(data.urgentTasks) ? data.urgentTasks : [];

                sections.push([
                    `Compliance snapshot: ${summary.totalTasks || 0} tracked tasks, ${summary.pendingCount || 0} pending, ${summary.overdueCount || 0} overdue, and ${summary.dueThisWeekCount || 0} due this week.`,
                    urgentTasks.length > 0 ? `- Urgent items: ${urgentTasks.slice(0, 3).map((task) => `${task.title || task.name || 'task'} (${task.status}${task.due_date ? `, due ${task.due_date}` : ''})`).join('; ')}.` : null
                ].filter(Boolean).join('\n'));

                nextActions.push('clear overdue compliance items before upcoming deadlines');
            }

            if (toolId === 'get_customer_insights') {
                const customers = Array.isArray(data.customers) ? data.customers : [];
                const topCustomers = customers.slice(0, 3).map(c => `${c.name || 'Customer'} (Revenue: ${formatCurrency(c.total_revenue || 0, currency)})`);
                
                sections.push([
                    `Customer Insights: Analyzing ${customers.length} total customers.`,
                    topCustomers.length > 0 ? `- Top customers by revenue: ${topCustomers.join('; ')}.` : null
                ].filter(Boolean).join('\n'));
                
                nextActions.push('review customer portfolio health and churn risk');
            }

            if (toolId === 'get_customer_details') {
                const intel = data.intelligence || {};
                sections.push([
                    `Customer Intelligence for ${intel.name || 'this client'}: Churn risk is ${intel.churn_risk_score || 0}/100.`,
                    `- Predicted next purchase: ${intel.predicted_next_purchase || 'unknown'}.`,
                    `- Total customer value: ${formatCurrency(intel.total_revenue || 0, currency)}.`
                ].join('\n'));
                
                nextActions.push('use these insights to personalize your next follow-up');
            }

            if (toolId === 'get_overdue_invoices') {
                const summary = data.summary || {};
                const critical = Array.isArray(data.overdueInvoices) ? data.overdueInvoices : [];
                
                sections.push([
                    `Critical Overdue Receivables: ${summary.overdueCount || 0} invoices totaling ${formatCurrency(summary.overdueAmount || 0, currency)} are overdue.`,
                    critical.length > 0 ? `- Most urgent: ${critical.slice(0, 2).map(inv => `#${inv.invoiceNumber} from ${inv.buyer?.name || 'Client'} (${formatCurrency(inv.balanceDue, currency)})`).join('; ')}.` : null
                ].join('\n'));
                
                nextActions.push('prioritize collections for the most overdue balances');
            }
        }

        if (
            recentActivity &&
            (lowerQuery.includes('recent activity') ||
                lowerQuery.includes('what happened recently') ||
                lowerQuery.includes('latest activity') ||
                lowerQuery.includes('what happened in the business'))
        ) {
            const currency = recentActivity.currency || dashboardSnapshot?.currency || 'INR';
            const invoices = Array.isArray(recentActivity.invoices) ? recentActivity.invoices : [];
            const payments = Array.isArray(recentActivity.payments) ? recentActivity.payments : [];
            const expenses = Array.isArray(recentActivity.expenses) ? recentActivity.expenses : [];

            return [
                'Recent business activity from your live data:',
                '',
                invoices.length > 0 ? `- Invoices: ${invoices.slice(0, 2).map((invoice) => `#${invoice.invoiceNumber} (${invoice.status}, ${formatCurrency(invoice.total || 0, currency)})`).join('; ')}.` : '- Invoices: no recent invoice activity found.',
                payments.length > 0 ? `- Payments: ${payments.slice(0, 2).map((payment) => `${payment.reference_number || payment.method || 'payment'} (${formatCurrency(payment.amount || 0, currency)} on ${payment.date || 'unknown date'})`).join('; ')}.` : '- Payments: no recent payment activity found.',
                expenses.length > 0 ? `- Expenses: ${expenses.slice(0, 2).map((expense) => `${expense.description || expense.category || 'expense'} (${formatCurrency(expense.amount || 0, currency)} on ${expense.date || 'unknown date'})`).join('; ')}.` : '- Expenses: no recent expense activity found.',
                '',
                'Next action: reconcile the latest cash movements and confirm they align with expected collections and planned spend.'
            ].join('\n');
        }

        if (
            dashboardSnapshot &&
            (lowerQuery.includes('how is the business doing') ||
                lowerQuery.includes('how are we doing') ||
                lowerQuery.includes('financial health') ||
                lowerQuery.includes('business health') ||
                lowerQuery.includes('financial position') ||
                lowerQuery.includes('finance') ||
                lowerQuery.includes('business performance') ||
                lowerQuery.includes('am i profitable') ||
                lowerQuery.includes('are we profitable') ||
                lowerQuery.includes('is the business profitable'))
        ) {
            const snapCurrency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};
            const netProfit = Number(snapshotStats.net_profit || 0);
            const profitMargin = Number(snapshotStats.profit_margin || 0);
            const safeToSpendAmt = Number(snapshotLiquidity.safeToSpend || 0);
            const overdueAmt = Number(snapshotStats.overdue_revenue || 0);
            const pendingAmt = Number(snapshotStats.pending_payments || 0);

            // Build a CFO verdict
            let verdict;
            if (overdueAmt > safeToSpendAmt && overdueAmt > 0) {
                verdict = `**Cash risk alert:** ${formatCurrency(overdueAmt, snapCurrency)} is overdue — more than your current safe-to-spend of ${formatCurrency(safeToSpendAmt, snapCurrency)}. Collections must be your immediate priority.`;
            } else if (netProfit > 0 && overdueAmt === 0) {
                verdict = `The business is in a healthy position — ${formatCurrency(netProfit, snapCurrency)} net profit with no overdue receivables and ${formatCurrency(safeToSpendAmt, snapCurrency)} of safe-to-spend cash.`;
            } else if (netProfit < 0) {
                verdict = `**Watch carefully:** The business is running at a loss of ${formatCurrency(Math.abs(netProfit), snapCurrency)} based on current records. Expenses are outpacing collected revenue.`;
            } else {
                verdict = `The business has ${formatCurrency(safeToSpendAmt, snapCurrency)} of verified safe-to-spend cash and ${formatCurrency(pendingAmt, snapCurrency)} still pending from customers.`;
            }

            return [
                verdict,
                '',
                `- Revenue collected: ${formatCurrency(snapshotStats.total_revenue || 0, snapCurrency)}.`,
                `- Total expenses recorded: ${formatCurrency(snapshotStats.total_expenses || 0, snapCurrency)}.`,
                netProfit !== 0 ? `- Net position: ${formatCurrency(netProfit, snapCurrency)} (${profitMargin}% margin).` : null,
                overdueAmt > 0 ? `- Overdue receivables: ${formatCurrency(overdueAmt, snapCurrency)} — this is reducing your effective cash position.` : null,
                '',
                `**${nextActions[0] || 'Review your collections pipeline and confirm your cash position before approving any new spend.'}**`
            ].filter(line => line !== null).join('\n');
        }

        if (
            dashboardSnapshot &&
            (lowerQuery.includes('focus') ||
                lowerQuery.includes('priority') ||
                lowerQuery.includes('priorities') ||
                lowerQuery.includes('what should i do') ||
                lowerQuery.includes('what should we do') ||
                lowerQuery.includes('what do i do') ||
                lowerQuery.includes('biggest risk') ||
                lowerQuery.includes('best move') ||
                lowerQuery.includes('most urgent') ||
                lowerQuery.includes('what matters') ||
                lowerQuery.includes('where should i focus'))
        ) {
            const priCurrency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};
            const overdueAmount = Number(invoiceWorkspace?.summary?.overdueAmount || snapshotStats.overdue_revenue || 0);
            const outstandingAmount = Number(invoiceWorkspace?.summary?.totalOutstanding || snapshotStats.pending_payments || 0);
            const spendThisMonth = Number(expenseWorkspace?.summary?.spendThisMonth || snapshotLiquidity.totalExpenses || 0);
            const dueThisWeek = Number(complianceWorkspace?.summary?.dueThisWeekCount || 0) + Number(complianceWorkspace?.summary?.overdueCount || 0);
            const collectedThisMonth = Number(paymentWorkspace?.summary?.collectedThisMonth || 0);
            const safeToSpendAmt = Number(snapshotLiquidity.safeToSpend || 0);
            const rankedPriorities = [];
            const secondaryFlags = [];

            // Rank priorities by financial impact
            if (overdueAmount > 0) {
                const overdueVsLiquidity = overdueAmount > safeToSpendAmt ? ' — this exceeds your current safe-to-spend cash' : '';
                rankedPriorities.push(`**#1 — Collect overdue receivables:** ${formatCurrency(overdueAmount, priCurrency)} is already overdue${overdueVsLiquidity}. Every day this sits is cash you don't have.`);
            }
            if (dueThisWeek > 0) {
                rankedPriorities.push(`**#${rankedPriorities.length + 1} — Compliance:** ${dueThisWeek} task${dueThisWeek > 1 ? 's are' : ' is'} overdue or due this week. Missed filings attract penalties.`);
            }
            if (spendThisMonth > collectedThisMonth && spendThisMonth > 0) {
                secondaryFlags.push(`Spending (${formatCurrency(spendThisMonth, priCurrency)}) is outpacing collections (${formatCurrency(collectedThisMonth, priCurrency)}) this period — watch your cash position.`);
            }
            if (outstandingAmount > 0 && overdueAmount === 0) {
                secondaryFlags.push(`${formatCurrency(outstandingAmount, priCurrency)} is outstanding but not yet overdue — stay on top of these before they age.`);
            }

            if (rankedPriorities.length === 0) {
                rankedPriorities.push(`No immediate red flags — the business has ${formatCurrency(safeToSpendAmt, priCurrency)} of verified safe-to-spend cash. Stay focused on collections to maintain this position.`);
            }

            return [
                rankedPriorities[0],
                '',
                ...rankedPriorities.slice(1),
                secondaryFlags.length > 0 ? '' : null,
                ...secondaryFlags.map(f => `- ${f}`),
                safeToSpendAmt > 0 ? `- Current safe-to-spend cash: ${formatCurrency(safeToSpendAmt, priCurrency)}.` : null,
                '',
                `**${nextActions[0] || 'Start with the highest-risk item above and work through the list in order.'}**`
            ].filter(line => line !== null).join('\n');
        }

        if (sections.length === 0) {
            return this.buildUnverifiedAnswer({}, ['no_tool_fallback_available']);
        }

        const uniqueActions = Array.from(new Set(nextActions));
        return [
            sections.join('\n\n'),
            '',
            `Next action: ${uniqueActions[0] || 'Ask a narrower grounded question.'}.`
        ].join('\n');
    }

    analyzeQueryRisk(query, execution = {}) {
        const text = String(query || '').toLowerCase();
        const hasToolEvidence = Boolean((execution.toolResults || []).length);
        const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasBoundedPhrase = (signal) => {
            const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(signal.toLowerCase())}([^a-z0-9]|$)`, 'i');
            return pattern.test(text);
        };

        // Only treat as private data when the user is asking about THEIR specific business
        // state. Generic domain words alone (invoice, payment, expense) are not private.
        const POSSESSIVE_RE = /\b(my|our|i have|do i|am i|are my|we have|i've|we've)\b/i;
        const SPECIFIC_DATA_PHRASES = [
            'safe to spend', 'cash flow', 'cashflow', 'runway',
            'overdue amount', 'outstanding balance', 'total outstanding',
            'how much (is |are )?(overdue|outstanding|pending)',
            'what.*(i|we) owe', 'what.*(owe|owed)'
        ];
        const temporalSignals = [
            'today', 'current', 'currently', 'latest', 'recent', 'recently',
            'right now', 'as of', 'this week', 'this month', 'this quarter', 'this year'
        ];
        const highStakesSignals = [
            'legal', 'law', 'gst', 'tds', 'tax', 'compliance', 'penalty', 'interest',
            'file return', 'filing', 'medical', 'diagnose', 'prescription', 'investment',
            'stock', 'sebi', 'contract'
        ];
        const domainSignals = [
            'invoice', 'invoices', 'payment', 'payments', 'expense', 'expenses',
            'compliance', 'gst', 'tds', 'receivable', 'receivables', 'vendor', 'vendors',
            'billing', 'receipt', 'reconcile', 'filing', 'return', 'deadline'
        ];
        const conversationalSafeSignals = [
            'hi', 'hello', 'hey', 'how are you', 'who are you', 'what can you do',
            'help', 'thanks', 'thank you', 'good morning', 'good evening',
            'good afternoon', 'good night', 'how are you doing', 'how are you doing these days',
            'what are the things you can do', 'can you help', 'are you online',
            'explore', 'navigate', 'system', 'capita', 'platform', 'capabilities'
        ];

        // Educational / general knowledge questions should always flow through to the LLM
        const EDUCATIONAL_RE = /^(what is|what are|what's|how does|how do|how can|how should|explain|can you explain|tell me about|describe|define|what'?s the difference|why is|why are|when (is|are|should|do)|which|give me an? (overview|example|summary)|what (does|do)|what (would|should|could)|help me understand|is (it|there|a)|are (there|these)|should i|can i|do i need|what happens|how (much|many) (does|do|should|would|is|are|can))\b/i;
        const isEducational = EDUCATIONAL_RE.test(text.trim());

        const hasPossessiveIntent = POSSESSIVE_RE.test(text);
        const hasSpecificDataPhrase = SPECIFIC_DATA_PHRASES.some(s =>
            typeof s === 'string' ? text.includes(s) : new RegExp(s, 'i').test(text)
        );
        const asksForPrivateData = hasPossessiveIntent || hasSpecificDataPhrase;
        const asksForCurrentInfo = temporalSignals.some((signal) => text.includes(signal));
        const highStakesDomain = highStakesSignals.some((signal) => text.includes(signal));
        const isDomainQuestion = domainSignals.some((signal) => text.includes(signal));
        const isConversationalSafe = conversationalSafeSignals.some((signal) => hasBoundedPhrase(signal));
        const requestsGuarantee = ['100%', 'guarantee', 'guaranteed', 'always correct', 'perfect answer']
            .some((signal) => text.includes(signal));

        const shouldRefuseGeneralAnswer = !hasToolEvidence && !isConversationalSafe && !isEducational && (
            asksForPrivateData ||
            (highStakesDomain && asksForCurrentInfo && !isEducational)
        );

        const confidence = hasToolEvidence ? 'grounded' : (shouldRefuseGeneralAnswer ? 'blocked' : 'general');

        return {
            hasToolEvidence,
            asksForPrivateData,
            asksForCurrentInfo,
            highStakesDomain,
            isDomainQuestion,
            isConversationalSafe,
            isEducational,
            requestsGuarantee,
            shouldRefuseGeneralAnswer,
            confidence
        };
    }

    buildSafetyMetadata(execution = {}, queryRisk = {}) {
        return {
            confidence: queryRisk.confidence || 'general',
            grounded: Boolean(queryRisk.hasToolEvidence),
            blocked: Boolean(queryRisk.shouldRefuseGeneralAnswer),
            requiresVerification: Boolean(!queryRisk.hasToolEvidence && queryRisk.highStakesDomain && queryRisk.asksForCurrentInfo),
            intent: queryRisk.intent || null,
            domain: execution.primaryDomain || null,
            specialistLabel: execution.specialistLabel || null,
            provenance: (execution.toolResults || []).map((entry) => ({
                tool: entry.toolId,
                source: entry.result?.meta?.source || null,
                generated_at: entry.result?.meta?.generated_at || null
            }))
        };
    }

    buildUnsupportedAnswer(queryRisk = {}) {
        if (queryRisk.asksForPrivateData) {
            return [
                'To answer this accurately, I need to retrieve your live workspace data.',
                '',
                'I only report figures that come directly from your records — no estimates or guesses.',
                '',
                'Try one of these:',
                '- "Show me my invoices"',
                '- "What are my recent payments?"',
                '- "How is my cash position?"',
                '- "Do I have any overdue filings?"',
                '',
                '→ Pick a workspace below to load your live data.'
            ].join('\n');
        }

        if (queryRisk.asksForCurrentInfo && queryRisk.highStakesDomain) {
            return [
                'This involves regulatory rules that change — I cannot give a definitive current answer without verified sources.',
                '',
                '- For GST, TDS, and tax rates: always verify against the latest CBIC or Income Tax portal.',
                '- I can track your specific compliance tasks and deadlines from your workspace.',
                '',
                '→ Ask "do I have any overdue filings?" and I will pull your live compliance data.'
            ].join('\n');
        }

        return [
            'I need more context to give a useful answer.',
            '',
            'Try asking about a specific area: invoices, payments, expenses, compliance, or cash position.',
            '→ The more specific your question, the more grounded my answer will be.'
        ].join('\n');
    }

    buildUnverifiedAnswer(queryRisk = {}, issues = []) {
        const issueText = issues.length > 0 ? ` The verification step rejected the draft for: ${issues.join(', ')}.` : '';
        return [
            `I need a verified data source to answer this accurately.${issueText}`,
            '',
            '- Ask a more specific question tied to a workspace area (invoices, payments, expenses, compliance).',
            queryRisk.highStakesDomain
                ? '- For tax, legal, or compliance topics: always verify AI output against the latest official source before acting.'
                : '- Try narrowing your question to a specific metric, customer, invoice group, or time window.',
            '',
            '→ Ask a grounded question and I will pull the live data to answer it.'
        ].join('\n');
    }
}

export default AIGroundingService;

