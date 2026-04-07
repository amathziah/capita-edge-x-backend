import { formatCurrency } from '../../core/utils/formatting.js';

class AIGroundingService {
    getSpecialistInstructions(execution = {}) {
        const domain = execution.primaryDomain || 'finance';
        const specialistLabel = execution.specialistLabel || 'Finance Guide';

        const domainInstruction = {
            invoices: 'You are a collections and receivables specialist. Focus on invoice status, overdue exposure, debtor priority, follow-up order, and cash recovery.',
            payments: 'You are a receipts and reconciliation specialist. Focus on incoming payments, settlement status, payment timing, reconciliation risk, and cash collection clarity.',
            expenses: 'You are a spend control specialist. Focus on expense mix, category concentration, burn, avoidable costs, and short-term savings opportunities.',
            compliance: 'You are a compliance specialist. Focus on due items, filing status, deadlines, and practical compliance sequencing.',
            finance: 'You are a pragmatic CFO operator. Focus on liquidity, collections, spend control, and the next operational move.',
            customers: 'You are a customer portfolio specialist. Focus on customer concentration, payer quality, and customer-specific collection or retention risk.',
            actions: 'You are an operations execution specialist. Focus on the exact next workflow or screen needed to complete the user request.',
            general: 'You are a concise finance operator.'
        }[domain] || 'You are a concise finance operator.';

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
            solopreneur: 'Act like a pragmatic CFO for an Indian freelancer. Prioritise collections, runway, taxes, margins, and concrete next actions.',
            subscription: 'Act like a SaaS finance lead. Prioritise MRR quality, churn, retention, and forecast clarity.',
            services_firm: 'Act like a services finance lead. Prioritise utilisation, project margins, receivables, and delivery risk.',
            ecommerce: 'Act like a commerce finance operator. Prioritise margin, working capital, receivables, and cash conversion.'
        }[businessSegment] || 'Act like a pragmatic finance operator.';

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

        return [
            'You are Capita, a grounded financial product agent.',
            personaInstructions,
            domainInstruction,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Detected intent: ${execution.intent || 'general_advice'}`,
            `Primary domain: ${domain}`,
            `Specialist mode: ${specialistLabel}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'Rules:',
            '- Treat TOOL results as the only source of truth for user-specific numbers.',
            '- If a needed fact is missing from TOOL results, say so plainly.',
            '- Do not invent private data, metrics, customer names, totals, or dates.',
            '- Be concise, specific, and operationally useful.',
            '- When tool evidence exists, cite the relevant business object in plain language.',
            '- Personalize recommendations to the user business, cash position, receivables, expense profile, and compliance state when those facts are present in TOOL results.',
            '- If the user asks what to do next, rank the most important actions using the available evidence instead of giving generic business advice.',
            '- If the query is general knowledge and there are no tools, answer carefully without pretending to see private data.',
            '- For GST, tax, legal, or compliance questions, include a brief verification note that the latest official source should be checked before acting.',
            '',
            `Execution mode: ${execution.mode || 'general'}`,
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'Respond in markdown with:',
            '1. A one-sentence executive answer.',
            '2. Short supporting bullets when useful.',
            '3. One clear next action.',
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
            solopreneur: 'Act like a pragmatic CFO for an Indian freelancer. Prioritise collections, runway, taxes, margins, and concrete next actions.',
            subscription: 'Act like a SaaS finance lead. Prioritise MRR quality, churn, retention, and forecast clarity.',
            services_firm: 'Act like a services finance lead. Prioritise utilisation, project margins, receivables, and delivery risk.',
            ecommerce: 'Act like a commerce finance operator. Prioritise margin, working capital, receivables, and cash conversion.'
        }[businessSegment] || 'Act like a pragmatic finance operator.';

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

        return [
            'You are Capita, a grounded financial product agent.',
            personaInstructions,
            domainInstruction,
            `Business: ${businessName}`,
            `Business type: ${businessSegment}`,
            `Detected intent: ${execution.intent || 'general_advice'}`,
            `Primary domain: ${domain}`,
            `Specialist mode: ${specialistLabel}`,
            `Currency: ${currency}`,
            `Current time: ${temporal.currentTime || new Date().toISOString()}`,
            '',
            'Return valid JSON only. No markdown.',
            '',
            'Rules:',
            '- Treat TOOL results as the only source of truth for user-specific numbers, names, totals, dates, statuses, and business facts.',
            '- If a fact is missing, do not infer it. Say it is unavailable.',
            '- Do not cite tools that were not provided.',
            '- Every summary or supporting point that states a business fact must cite at least one tool.',
            '- `next_action` may be advice, but must not introduce new business facts.',
            '- If the user asks for priorities, recommendations, business health, or what to do next, tailor the answer to the business type and rank advice using the available evidence.',
            '- Keep the answer concise and operational.',
            '',
            `Execution mode: ${execution.mode || 'general'}`,
            `User question: ${query}`,
            '',
            'Tool evidence:',
            evidenceLines || 'NO_TOOL_RESULTS',
            '',
            'JSON schema:',
            '{',
            '  "summary": "string",',
            '  "bullets": [{"text": "string", "citations": [{"tool": "tool_id"}]}],',
            '  "next_action": "string",',
            '  "citations": [{"tool": "tool_id"}],',
            '  "verification_status": "grounded" | "insufficient_evidence" | "requires_professional_review"',
            '}'
        ].join('\n');
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
        const citations = (payload.citations || [])
            .map((citation) => citation?.tool)
            .filter(Boolean);
        const citationSuffix = citations.length > 0
            ? ` [Sources: ${Array.from(new Set(citations)).join(', ')}]`
            : '';

        const bulletLines = (payload.bullets || [])
            .filter((bullet) => bullet?.text)
            .map((bullet) => {
                const bulletSources = (bullet.citations || [])
                    .map((citation) => citation?.tool)
                    .filter(Boolean);
                const bulletSuffix = bulletSources.length > 0
                    ? ` [Source: ${Array.from(new Set(bulletSources)).join(', ')}]`
                    : '';
                return `- ${bullet.text}${bulletSuffix}`;
            });

        return [
            `${payload.summary || 'I do not have enough verified evidence to answer that.'}${citationSuffix}`,
            bulletLines.length > 0 ? '' : null,
            bulletLines.length > 0 ? bulletLines.join('\n') : null,
            '',
            `Next action: ${payload.next_action || 'Ask a narrower grounded question.'}`
        ].filter(Boolean).join('\n');
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
                lowerQuery.includes('business performance'))
        ) {
            const currency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};

            return [
                `The business is currently operating with ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)} of verified safe-to-spend cash, ${formatCurrency(snapshotStats.pending_payments || 0, currency)} still pending from customers, and ${formatCurrency(snapshotStats.overdue_revenue || 0, currency)} already overdue.`,
                '',
                `- Revenue collected from paid invoices: ${formatCurrency(snapshotStats.total_revenue || 0, currency)}.`,
                `- Total recorded expenses: ${formatCurrency(snapshotStats.total_expenses || 0, currency)}.`,
                `- Net profit from current records: ${formatCurrency(snapshotStats.net_profit || 0, currency)} with a ${snapshotStats.profit_margin || 0}% margin.`,
                '',
                `Next action: ${nextActions[0] || 'review receivables, liquidity, and current cost pressure before making new commitments.'}`
            ].join('\n');
        }

        if (
            dashboardSnapshot &&
            (lowerQuery.includes('focus') ||
                lowerQuery.includes('priority') ||
                lowerQuery.includes('priorities') ||
                lowerQuery.includes('what should i do') ||
                lowerQuery.includes('what should we do') ||
                lowerQuery.includes('how are we doing') ||
                lowerQuery.includes('business health') ||
                lowerQuery.includes('biggest risk') ||
                lowerQuery.includes('best move'))
        ) {
            const currency = dashboardSnapshot.currency || 'INR';
            const snapshotStats = dashboardSnapshot.stats || {};
            const snapshotLiquidity = dashboardSnapshot.safeToSpend || {};
            const overdueAmount = Number(invoiceWorkspace?.summary?.overdueAmount || snapshotStats.overdue_revenue || 0);
            const outstandingAmount = Number(invoiceWorkspace?.summary?.totalOutstanding || snapshotStats.pending_payments || 0);
            const spendThisMonth = Number(expenseWorkspace?.summary?.spendThisMonth || snapshotLiquidity.totalExpenses || 0);
            const dueThisWeek = Number(complianceWorkspace?.summary?.dueThisWeekCount || 0) + Number(complianceWorkspace?.summary?.overdueCount || 0);
            const collectedThisMonth = Number(paymentWorkspace?.summary?.collectedThisMonth || 0);
            const priorities = [];

            if (overdueAmount > 0) {
                priorities.push(`Collections is the top priority because ${formatCurrency(overdueAmount, currency)} is already overdue and ${formatCurrency(outstandingAmount, currency)} is still outstanding.`);
            }
            if (dueThisWeek > 0) {
                priorities.push(`Compliance needs attention because ${dueThisWeek} items are overdue or due this week.`);
            }
            if (spendThisMonth > collectedThisMonth && spendThisMonth > 0) {
                priorities.push(`Cash discipline matters because this month spend of ${formatCurrency(spendThisMonth, currency)} is ahead of recorded collections of ${formatCurrency(collectedThisMonth, currency)}.`);
            }
            if (priorities.length === 0) {
                priorities.push(`The business looks stable from current records, with ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)} of verified safe-to-spend cash and no immediate red flags in the retrieved workspaces.`);
            }

            return [
                priorities[0],
                '',
                ...priorities.slice(1).map((line) => `- ${line}`),
                snapshotLiquidity.safeToSpend !== undefined ? `- Verified safe-to-spend cash: ${formatCurrency(snapshotLiquidity.safeToSpend || 0, currency)}.` : null,
                '',
                `Next action: ${nextActions[0] || 'review the highest-risk item first and then recheck cash position.'}`
            ].filter(Boolean).join('\n');
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

        const privateDataSignals = [
            'my ', 'our ', 'business', 'workspace', 'dashboard', 'revenue', 'profit',
            'margin', 'cash flow', 'cashflow', 'safe to spend', 'overdue', 'invoice',
            'invoices', 'customer', 'customers', 'client', 'clients', 'payment', 'payments',
            'expense', 'expenses', 'receivable', 'receivables', 'runway'
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
            'what are the things you can do', 'can you help', 'are you online'
        ];

        const asksForPrivateData = privateDataSignals.some((signal) => text.includes(signal));
        const asksForCurrentInfo = temporalSignals.some((signal) => text.includes(signal));
        const highStakesDomain = highStakesSignals.some((signal) => text.includes(signal));
        const isDomainQuestion = domainSignals.some((signal) => text.includes(signal));
        const isConversationalSafe = conversationalSafeSignals.some((signal) => hasBoundedPhrase(signal));
        const requestsGuarantee = ['100%', 'guarantee', 'guaranteed', 'always correct', 'perfect answer']
            .some((signal) => text.includes(signal));

        const shouldRefuseGeneralAnswer = !hasToolEvidence && !isConversationalSafe && (
            asksForPrivateData ||
            (highStakesDomain && asksForCurrentInfo)
        );

        const confidence = hasToolEvidence ? 'grounded' : (shouldRefuseGeneralAnswer ? 'blocked' : 'general');

        return {
            hasToolEvidence,
            asksForPrivateData,
            asksForCurrentInfo,
            highStakesDomain,
            isDomainQuestion,
            isConversationalSafe,
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
        const reasons = [];

        if (queryRisk.asksForPrivateData) {
            reasons.push('your workspace-specific data was not retrieved by a tool');
        }

        if (queryRisk.asksForCurrentInfo && queryRisk.highStakesDomain) {
            reasons.push('the question needs current high-stakes verification');
        }

        const reasonText = reasons.length > 0
            ? reasons.join(' and ')
            : 'the answer cannot be verified safely from the current context';

        return [
            `I can’t answer that as certain fact because ${reasonText}.`,
            '',
            '- I only treat tool results as authoritative for private business metrics.',
            '- For changing legal, tax, or compliance rules, this system should verify the latest source before speaking with certainty.',
            '- Ask a grounded workspace question or provide a narrower general question that does not depend on current private data.',
            '',
            '→ Next action: rephrase the question so it can be answered from available tools or verified sources.'
        ].join('\n');
    }

    buildUnverifiedAnswer(queryRisk = {}, issues = []) {
        const issueText = issues.length > 0 ? ` The verification step rejected the draft for: ${issues.join(', ')}.` : '';
        return [
            `I’m not returning an AI-generated answer because it could not be verified against the backend evidence.${issueText}`,
            '',
            '- This system now rejects answers that cite missing tools or introduce unsupported business facts.',
            '- Ask a narrower question, or retrieve the needed data first so the response can be grounded.',
            queryRisk.highStakesDomain
                ? '- For tax, legal, compliance, or other high-stakes topics, treat AI output as support material and verify it against the latest official source before acting.'
                : '- The safest next step is to ask for a specific metric, customer, invoice group, or time window.',
            '',
            '→ Next action: ask a more specific grounded question.'
        ].join('\n');
    }
}

export default AIGroundingService;
