class AIActionRegistryService {
    extractCreateCustomerPayload(query) {
        const raw = String(query || '');
        const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        const email = emailMatch ? emailMatch[0] : null;

        const namedMatch = raw.match(/(?:named|called)\s+["']?([^"',]+?)["']?(?:\s|$)/i);
        const quotedMatch = raw.match(/["']([^"']+)["']/);

        let name = namedMatch?.[1] || quotedMatch?.[1] || '';
        if (!name) {
            const cleaned = raw
                .replace(/create|add|new|customer|client/gi, ' ')
                .replace(email || '', ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned && cleaned.length <= 80) {
                name = cleaned;
            }
        }

        name = String(name || '').trim();
        if (!name) return null;

        return {
            name,
            email,
            phone: null,
            address: null
        };
    }

    suggestAction(query, context = {}, execution = {}) {
        const lowerQuery = String(query || '').toLowerCase();

        if ((lowerQuery.includes('create') || lowerQuery.includes('add') || lowerQuery.includes('new')) &&
            (lowerQuery.includes('customer') || lowerQuery.includes('client'))) {
            const payload = this.extractCreateCustomerPayload(query);
            if (payload?.name) {
                return {
                    type: 'create_customer',
                    requiresConfirmation: true,
                    requiresServerExecution: true,
                    confirmationMessage: `Create customer "${payload.name}" now?`,
                    data: {
                        ...payload,
                        source: 'ai_action_registry',
                        traceHint: execution.traceId || null
                    }
                };
            }
        }

        if ((lowerQuery.includes('create') || lowerQuery.includes('new')) && lowerQuery.includes('invoice')) {
            return {
                type: 'open_invoice_modal',
                requiresConfirmation: true,
                confirmationMessage: 'Open the invoice flow with a prefilled draft proposal?',
                data: {
                    source: 'ai_action_registry',
                    traceHint: execution.traceId || null
                }
            };
        }

        if ((lowerQuery.includes('add') || lowerQuery.includes('create') || lowerQuery.includes('new')) &&
            (lowerQuery.includes('customer') || lowerQuery.includes('client'))) {
            return {
                type: 'open_customer_modal',
                requiresConfirmation: true,
                confirmationMessage: 'Open the customer form and start a new client entry?',
                data: {
                    source: 'ai_action_registry',
                    traceHint: execution.traceId || null
                }
            };
        }

        if ((lowerQuery.includes('show') || lowerQuery.includes('open') || lowerQuery.includes('go to')) &&
            lowerQuery.includes('invoice')) {
            return {
                type: 'navigate',
                requiresConfirmation: true,
                confirmationMessage: 'Go to the invoices page?',
                data: {
                    to: '/invoices',
                    source: 'ai_action_registry',
                    traceHint: execution.traceId || null
                }
            };
        }

        if ((lowerQuery.includes('show') || lowerQuery.includes('open') || lowerQuery.includes('go to')) &&
            (lowerQuery.includes('customer') || lowerQuery.includes('client'))) {
            return {
                type: 'navigate',
                requiresConfirmation: true,
                confirmationMessage: 'Go to the customers page?',
                data: {
                    to: '/customers',
                    source: 'ai_action_registry',
                    traceHint: execution.traceId || null
                }
            };
        }

        return null;
    }
}

export default new AIActionRegistryService();
