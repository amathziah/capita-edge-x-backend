// Helpers for grounding LLM JSON output against source numbers (invoice OCR /
// audit / collection draft validators). Kept inline so this service is
// self-contained.
const _normaliseClaimNumber = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const cleaned = raw.replace(/,/g, '');
    const numeric = Number(cleaned.replace(/%$/, ''));
    if (!Number.isFinite(numeric)) return null;
    return `${numeric}${cleaned.endsWith('%') ? '%' : ''}`;
};

const _extractClaimNumbers = (text = '') => {
    const matches = String(text).match(/\b\d[\d,]*(?:\.\d+)?%?\b/g) || [];
    return matches.map(_normaliseClaimNumber).filter(Boolean);
};

const _collectEvidenceFacts = (value, acc = { numbers: new Set() }) => {
    if (value === null || value === undefined) return acc;
    if (typeof value === 'number') {
        const n = _normaliseClaimNumber(value);
        if (n) acc.numbers.add(n);
        return acc;
    }
    if (typeof value === 'string') {
        for (const n of _extractClaimNumbers(value)) acc.numbers.add(n);
        return acc;
    }
    if (Array.isArray(value)) {
        value.forEach(item => _collectEvidenceFacts(item, acc));
        return acc;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach(item => _collectEvidenceFacts(item, acc));
    }
    return acc;
};

const _collectExecutionEvidence = (execution = {}) => {
    const numbers = new Set();
    for (const entry of execution.toolResults || []) {
        _collectEvidenceFacts(entry?.result?.data, { numbers });
        _collectEvidenceFacts(entry?.result?.meta, { numbers });
    }
    return { numbers };
};

class AIStructuredTaskService {
    constructor({
        cacheKey,
        cacheGet,
        cacheSet,
        cacheTtl,
        models,
        hasModelClient,
        canMakeRequest,
        consumeToken,
        getModel,
        isRetryable,
        executeWithLock,
    } = {}) {
        this.cacheKey = cacheKey;
        this.cacheGet = cacheGet;
        this.cacheSet = cacheSet;
        this.cacheTtl = cacheTtl || {};
        this.models = models || [];
        this.hasModelClient = hasModelClient || (() => false);
        this.canMakeRequest = canMakeRequest || (() => false);
        this.consumeToken = consumeToken || (() => {});
        this.getModel = getModel || (() => null);
        this.isRetryable = isRetryable || (() => false);
        this.executeWithLock = executeWithLock || (async (key, fn) => fn());
        this.collectExecutionEvidence = _collectExecutionEvidence;
        this.extractClaimNumbers = _extractClaimNumbers;
    }

    parseJsonText(rawText = '') {
        return JSON.parse(
            String(rawText || '')
                .trim()
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim()
        );
    }

    buildGenericValidationError(message = 'The AI response could not be verified safely.') {
        return new Error(message);
    }

    validateInvoiceExtractionPayload(payload = {}, sourceText = '') {
        const issues = [];
        const sourceNumbers = this.extractClaimNumbers(sourceText);
        const payloadNumbers = Array.from(this.collectExecutionEvidence({
            toolResults: [{ toolId: 'source_text', result: { data: payload, meta: {} } }]
        }).numbers);

        for (const number of payloadNumbers) {
            if (!sourceNumbers.includes(number)) {
                issues.push(`unsupported_numbers:${number}`);
            }
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateAuditPayload(payload = {}, invoiceData = {}) {
        const issues = [];
        if (!Number.isFinite(payload.riskScore) || payload.riskScore < 0 || payload.riskScore > 100) {
            issues.push('invalid_risk_score');
        }
        if (!Array.isArray(payload.suggestions) || payload.suggestions.some((entry) => typeof entry !== 'string')) {
            issues.push('invalid_suggestions');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'invoice_input', result: { data: invoiceData, meta: {} } }]
        }).numbers;
        const suggestionNumbers = this.extractClaimNumbers((payload.suggestions || []).join('\n'));
        const unsupportedNumbers = suggestionNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateCollectionDraftPayload(payload = {}, invoice = {}) {
        const issues = [];
        if (typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
            issues.push('missing_subject');
        }
        if (typeof payload.body !== 'string' || payload.body.trim().length === 0) {
            issues.push('missing_body');
        }
        if ('discountOffered' in payload && typeof payload.discountOffered !== 'boolean') {
            issues.push('invalid_discount_flag');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'invoice_input', result: { data: invoice, meta: {} } }]
        }).numbers;
        const draftNumbers = this.extractClaimNumbers(`${payload.subject || ''}\n${payload.body || ''}`);
        const unsupportedNumbers = draftNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateCommandPayload(payload = {}) {
        const issues = [];
        const validTypes = new Set(['create_customer', 'unknown']);

        if (!validTypes.has(payload.type)) {
            issues.push('invalid_type');
        }

        if (payload.type === 'create_customer') {
            if (!payload.data || typeof payload.data !== 'object') {
                issues.push('missing_data');
            } else if (typeof payload.data.name !== 'string' || payload.data.name.trim().length === 0) {
                issues.push('missing_customer_name');
            }
        }

        if (payload.message !== undefined && typeof payload.message !== 'string') {
            issues.push('invalid_message');
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    validateAgentPayload(payload = {}, contextData = {}) {
        const issues = [];
        if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
            issues.push('missing_text');
        }

        const evidenceNumbers = this.collectExecutionEvidence({
            toolResults: [{ toolId: 'agent_context', result: { data: contextData, meta: {} } }]
        }).numbers;
        const payloadNumbers = this.extractClaimNumbers(payload.text || '');
        const unsupportedNumbers = payloadNumbers.filter((number) => !evidenceNumbers.has(number));
        if (unsupportedNumbers.length > 0) {
            issues.push(`unsupported_numbers:${Array.from(new Set(unsupportedNumbers)).join(',')}`);
        }

        return {
            ok: issues.length === 0,
            issues
        };
    }

    async safeJsonModelCall({
        prompt,
        cacheKey = null,
        cacheTtl = null,
        validator = null,
        sanitise = null,
        providerSuffix = 'json'
    } = {}) {
        if (cacheKey) {
            const cached = this.cacheGet(cacheKey);
            if (cached) {
                return { ...cached, provider: `${cached.provider}:cached` };
            }
        }

        if (!this.hasModelClient() || !this.canMakeRequest()) {
            throw new Error('Cloud Busy: AI structured generation is currently unavailable.');
        }

        for (const modelName of this.models) {
            try {
                this.consumeToken();
                const modelInstance = this.getModel(modelName, true);
                const result = await modelInstance.generateContent(prompt);
                const response = await result.response;
                const parsed = this.parseJsonText(response.text());
                const validation = validator ? validator(parsed) : { ok: true, issues: [] };

                if (!validation.ok) {
                    throw this.buildGenericValidationError(`AI verification failed: ${validation.issues.join(', ')}`);
                }

                const base = sanitise ? sanitise(parsed) : parsed;
                const responseData = {
                    ...base,
                    usage: response.usageMetadata,
                    provider: `cloud:${modelName}:${providerSuffix}`
                };

                if (cacheKey && cacheTtl) {
                    this.cacheSet(cacheKey, responseData, cacheTtl);
                }

                return responseData;
            } catch (error) {
                if (this.isRetryable(error)) continue;
                throw error;
            }
        }

        throw new Error('Cloud Busy: Unable to complete structured AI request safely.');
    }

    async parseInvoiceText(text, userId = 'anon') {
        return this.executeWithLock(`parse_${userId}_${text.slice(0, 20)}`, async () => {
            const cacheKey = this.cacheKey('invoice', text);
            const cached = this.cacheGet(cacheKey);
            if (cached) {
                console.log('📡 Cache HIT for invoice parse');
                return { ...cached, provider: `${cached.provider}:cached` };
            }

            if (!this.hasModelClient() || !this.canMakeRequest()) {
                throw new Error('Cloud Busy: Unable to parse invoice using cloud models.');
            }

            for (const modelName of this.models) {
                try {
                    this.consumeToken();
                    const modelInstance = this.getModel(modelName, true);
                    const prompt = `Parse this text into a strict JSON invoice.
Only include values directly present in the source text. Do not infer missing numeric values.
Source text:
${text}`;
                    const result = await modelInstance.generateContent(prompt);
                    const response = await result.response;
                    const parsed = this.parseJsonText(response.text());
                    const validation = this.validateInvoiceExtractionPayload(parsed, text);

                    if (!validation.ok) {
                        throw this.buildGenericValidationError(`AI verification failed: ${validation.issues.join(', ')}`);
                    }

                    const responseData = { ...parsed, usage: response.usageMetadata, provider: `cloud:${modelName}:magic` };
                    this.cacheSet(cacheKey, responseData, this.cacheTtl.invoice);

                    return responseData;
                } catch (error) {
                    if (this.isRetryable(error)) continue;
                    break;
                }
            }

            throw new Error('Cloud Busy: Unable to parse invoice using cloud models.');
        });
    }

    async auditInvoice(invoiceData) {
        const cacheKey = this.cacheKey('audit', JSON.stringify(invoiceData));
        const prompt = `You are a strict financial auditor. Audit this invoice for errors (GST/Tax errors, pricing logic, missing information, risk of rejection).
        Invoice: ${JSON.stringify(invoiceData)}
        Return a strict JSON object: { "riskScore": number (0-100), "suggestions": string[] }.
        Suggestions must stay grounded in the provided invoice data and must not invent amounts, dates, or counterparties.`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.cacheTtl.invoice,
            providerSuffix: 'audit',
            prompt,
            validator: (payload) => this.validateAuditPayload(payload, invoiceData),
            sanitise: (payload) => ({
                riskScore: payload.riskScore ?? 0,
                suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : ['Unable to verify audit suggestions safely.']
            })
        });
    }

    async generateCollectionDraft(invoice, forceAggressive = false) {
        const cacheKey = this.cacheKey('draft', `${invoice.invoiceNumber}_${forceAggressive}`);
        const prompt = `Generate a collection email draft as strict JSON only.
Invoice context: ${JSON.stringify(invoice)}
Tone: ${forceAggressive ? 'firm' : 'professional'}.
Use only facts present in the invoice context.
Return: { "subject": string, "body": string, "discountOffered": boolean }`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.cacheTtl.draft,
            providerSuffix: 'draft',
            prompt,
            validator: (payload) => this.validateCollectionDraftPayload(payload, invoice),
            sanitise: (payload) => ({
                subject: payload.subject.trim(),
                body: payload.body.trim(),
                discountOffered: Boolean(payload.discountOffered)
            })
        });
    }

    async generateSettlementOffer(invoice) {
        const cacheKey = this.cacheKey('draft', `settle_${invoice.invoiceNumber}`);
        const prompt = `Generate a settlement negotiation email as strict JSON only.
Invoice context: ${JSON.stringify(invoice)}
Use only invoice facts supplied here. Do not invent new amounts or deadlines.
Return: { "subject": string, "body": string, "discountOffered": boolean }`;

        return this.safeJsonModelCall({
            cacheKey,
            cacheTtl: this.cacheTtl.draft,
            providerSuffix: 'settle',
            prompt,
            validator: (payload) => this.validateCollectionDraftPayload(payload, invoice),
            sanitise: (payload) => ({
                subject: payload.subject.trim(),
                body: payload.body.trim(),
                discountOffered: Boolean(payload.discountOffered)
            })
        });
    }

    async parseCommand(text) {
        return this.safeJsonModelCall({
            providerSuffix: 'cmd',
            prompt: `Parse this command into strict JSON only.
Supported action types: "create_customer", "unknown".
Return schema:
{ "type": "create_customer" | "unknown", "message": string, "data": { "name"?: string, "email"?: string, "phone"?: string, "address"?: string } }
If the command does not clearly map to a supported action, return type "unknown".
Command: "${text}"`,
            validator: (payload) => this.validateCommandPayload(payload),
            sanitise: (payload) => ({
                type: payload.type,
                message: typeof payload.message === 'string' ? payload.message : '',
                data: payload.data && typeof payload.data === 'object' ? payload.data : {}
            })
        });
    }
}

export default AIStructuredTaskService;
