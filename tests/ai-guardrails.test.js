import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key';

const aiService = (await import('../src/modules/ai/ai.service.js')).default;
const aiToolRegistryService = (await import('../src/modules/ai/aiToolRegistry.service.js')).default;
const aiActionRegistryService = (await import('../src/modules/ai/aiActionRegistry.service.js')).default;

test('analyzeQueryRisk blocks private workspace questions without tool evidence', () => {
    const risk = aiService.analyzeQueryRisk('What is my current overdue amount?', {
        toolResults: []
    });

    assert.equal(risk.hasToolEvidence, false);
    assert.equal(risk.asksForPrivateData, true);
    assert.equal(risk.shouldRefuseGeneralAnswer, true);
    assert.equal(risk.confidence, 'blocked');
});

test('analyzeQueryRisk allows grounded workspace questions when tool evidence exists', () => {
    const risk = aiService.analyzeQueryRisk('What is my current overdue amount?', {
        toolResults: [{ toolId: 'get_overdue_receivables', result: { data: {}, meta: {} } }]
    });

    assert.equal(risk.hasToolEvidence, true);
    assert.equal(risk.shouldRefuseGeneralAnswer, false);
    assert.equal(risk.confidence, 'grounded');
});

test('buildUnsupportedAnswer explains why certainty is blocked', () => {
    const text = aiService.buildUnsupportedAnswer({
        asksForPrivateData: true,
        asksForCurrentInfo: true,
        highStakesDomain: true
    });

    assert.match(text, /I can’t answer that as certain fact/i);
    assert.match(text, /workspace-specific data/i);
    assert.match(text, /current high-stakes verification/i);
});

test('analyzeQueryRisk blocks unverified high-stakes general questions', () => {
    const risk = aiService.analyzeQueryRisk('Should I file GST this way?', {
        toolResults: []
    });

    assert.equal(risk.highStakesDomain, true);
    assert.equal(risk.shouldRefuseGeneralAnswer, true);
    assert.equal(risk.confidence, 'blocked');
});

test('analyzeQueryRisk blocks low-stakes questions when no evidence is available', () => {
    const risk = aiService.analyzeQueryRisk('What is runway?', {
        toolResults: []
    });

    assert.equal(risk.hasToolEvidence, false);
    assert.equal(risk.shouldRefuseGeneralAnswer, true);
    assert.equal(risk.confidence, 'blocked');
});

test('analyzeQueryRisk allows conversational questions without tool evidence', () => {
    const risk = aiService.analyzeQueryRisk('How are you doing these days?', {
        toolResults: []
    });

    assert.equal(risk.hasToolEvidence, false);
    assert.equal(risk.isConversationalSafe, true);
    assert.equal(risk.shouldRefuseGeneralAnswer, false);
    assert.equal(risk.confidence, 'general');
});

test('buildToolBackedFallbackAnswer returns deterministic invoice text from grounded data', () => {
    const text = aiService.buildToolBackedFallbackAnswer('Who still owes me money?', {
        toolResults: [{
            toolId: 'get_invoice_workspace',
            result: {
                data: {
                    summary: {
                        totalInvoices: 21,
                        totalOutstanding: 1264547,
                        overdueAmount: 646109
                    },
                    recentInvoices: [
                        { invoiceNumber: 'ST-020-DRAFT-RETAINER', status: 'sent', total: 139240 }
                    ],
                    overdueInvoices: [
                        { invoiceNumber: 'ST-004-SENT-DUE-TODAY', daysOverdue: 14, balanceDue: 63720 }
                    ],
                    currency: 'INR'
                },
                meta: {
                    source: 'invoices+invoiceStatus.service',
                    generated_at: '2026-04-07T00:00:00.000Z'
                }
            }
        }]
    });

    assert.match(text, /Receivables needing action/i);
    assert.match(text, /₹12,64,547\.00/);
    assert.match(text, /₹6,46,109\.00/);
    assert.match(text, /ST-004-SENT-DUE-TODAY/);
    assert.match(text, /Next action:/);
});

test('buildToolBackedFallbackAnswer answers overdue invoice count directly when asked for quantity', () => {
    const text = aiService.buildToolBackedFallbackAnswer('How many overdue invoices do I have?', {
        toolResults: [{
            toolId: 'get_invoice_workspace',
            result: {
                data: {
                    summary: {
                        overdueCount: 7,
                        overdueAmount: 646109,
                        totalOutstanding: 1264547
                    },
                    overdueInvoices: [
                        { invoiceNumber: 'ST-004-SENT-DUE-TODAY', daysOverdue: 15, balanceDue: 63720 }
                    ],
                    currency: 'INR'
                },
                meta: {}
            }
        }]
    });

    assert.match(text, /7 overdue invoices/i);
    assert.match(text, /₹6,46,109\.00/);
});

test('buildToolBackedFallbackAnswer treats "over due" phrasing as overdue invoice count question', () => {
    const text = aiService.buildToolBackedFallbackAnswer('How many over due invoices do I have?', {
        toolResults: [{
            toolId: 'get_invoice_workspace',
            result: {
                data: {
                    summary: {
                        overdueCount: 7,
                        overdueAmount: 646109,
                        totalOutstanding: 1264547
                    },
                    overdueInvoices: [
                        { invoiceNumber: 'ST-004-SENT-DUE-TODAY', daysOverdue: 15, balanceDue: 63720 }
                    ],
                    currency: 'INR'
                },
                meta: {}
            }
        }]
    });

    assert.match(text, /7 overdue invoices/i);
});

test('buildToolBackedFallbackAnswer returns runway estimate from dashboard snapshot', () => {
    const text = aiService.buildToolBackedFallbackAnswer('What is my estimated cash runway based on current trends?', {
        toolResults: [{
            toolId: 'get_dashboard_snapshot',
            result: {
                data: {
                    stats: {
                        total_expenses: 227739
                    },
                    safeToSpend: {
                        safeToSpend: 400000,
                        cashOnHand: 500000,
                        totalExpenses: 100000,
                        reserves: {
                            gst: 25000,
                            incomeTax: 50000,
                            atRisk: 25000
                        }
                    },
                    currency: 'INR'
                },
                meta: {
                    source: 'analytics.getDashboardStats+analytics.getSafeToSpend',
                    generated_at: '2026-04-07T00:00:00.000Z'
                }
            }
        }]
    });

    assert.match(text, /Estimated cash runway is about 4 months/i);
    assert.match(text, /₹4,00,000\.00/);
    assert.match(text, /₹1,00,000\.00/);
});

test('buildToolBackedFallbackAnswer ranks personalized business priorities from grounded data', () => {
    const text = aiService.buildToolBackedFallbackAnswer('What should I focus on in my business right now?', {
        toolResults: [
            {
                toolId: 'get_dashboard_snapshot',
                result: {
                    data: {
                        stats: {
                            pending_payments: 1264547,
                            overdue_revenue: 646109
                        },
                        safeToSpend: {
                            safeToSpend: 300000,
                            totalExpenses: 200000
                        },
                        currency: 'INR'
                    },
                    meta: {}
                }
            },
            {
                toolId: 'get_invoice_workspace',
                result: {
                    data: {
                        summary: {
                            overdueAmount: 646109,
                            totalOutstanding: 1264547
                        },
                        currency: 'INR'
                    },
                    meta: {}
                }
            },
            {
                toolId: 'get_payment_workspace',
                result: {
                    data: {
                        summary: {
                            collectedThisMonth: 115640
                        },
                        currency: 'INR'
                    },
                    meta: {}
                }
            },
            {
                toolId: 'get_expense_workspace',
                result: {
                    data: {
                        summary: {
                            spendThisMonth: 214648
                        },
                        currency: 'INR'
                    },
                    meta: {}
                }
            },
            {
                toolId: 'get_compliance_workspace',
                result: {
                    data: {
                        summary: {
                            overdueCount: 1,
                            dueThisWeekCount: 1
                        }
                    },
                    meta: {}
                }
            }
        ]
    });

    assert.match(text, /Collections is the top priority/i);
    assert.match(text, /₹6,46,109\.00/);
    assert.match(text, /Verified safe-to-spend cash: ₹3,00,000\.00/);
});

test('buildToolBackedFallbackAnswer answers broad business health from advisor context', () => {
    const text = aiService.buildToolBackedFallbackAnswer('How is the business doing financially right now?', {
        toolResults: [{
            toolId: 'get_business_advisor_context',
            result: {
                data: {
                    snapshot: {
                        stats: {
                            pending_payments: 1264547,
                            overdue_revenue: 646109,
                            total_revenue: 535543,
                            total_expenses: 227739,
                            net_profit: 307804,
                            profit_margin: 57.48
                        },
                        safeToSpend: {
                            safeToSpend: 300000
                        },
                        currency: 'INR'
                    }
                },
                meta: {}
            }
        }]
    });

    assert.match(text, /₹3,00,000\.00 of verified safe-to-spend cash/);
    assert.match(text, /₹12,64,547\.00 still pending/);
    assert.match(text, /57.48% margin/);
});

test('validateGroundedPayload accepts grounded payload with valid citations and evidence-backed numbers', () => {
    const execution = {
        toolResults: [{
            toolId: 'get_dashboard_snapshot',
            result: {
                data: {
                    stats: {
                        total_revenue: 125000,
                        profit_margin: 32.5
                    }
                },
                meta: {
                    source: 'analytics.getDashboardStats',
                    generated_at: '2026-04-07T00:00:00.000Z'
                }
            }
        }]
    };

    const validation = aiService.validateGroundedPayload({
        summary: 'Revenue is 125000 with a 32.5% margin.',
        bullets: [{
            text: 'The current margin is 32.5%.',
            citations: [{ tool: 'get_dashboard_snapshot' }]
        }],
        next_action: 'Review the highest-margin work and protect cash collection speed.',
        citations: [{ tool: 'get_dashboard_snapshot' }],
        verification_status: 'grounded'
    }, execution, { highStakesDomain: false });

    assert.equal(validation.ok, true);
    assert.deepEqual(validation.issues, []);
});

test('validateGroundedPayload rejects unsupported numeric claims', () => {
    const execution = {
        toolResults: [{
            toolId: 'get_overdue_receivables',
            result: {
                data: {
                    ageing: {
                        totalOverdue: 42000
                    }
                },
                meta: {
                    source: 'invoices+invoiceStatus.service',
                    generated_at: '2026-04-07T00:00:00.000Z'
                }
            }
        }]
    };

    const validation = aiService.validateGroundedPayload({
        summary: 'Total overdue is 99000.',
        bullets: [{
            text: 'Receivables overdue are 99000.',
            citations: [{ tool: 'get_overdue_receivables' }]
        }],
        next_action: 'Follow up with the oldest debtors this week.',
        citations: [{ tool: 'get_overdue_receivables' }],
        verification_status: 'grounded'
    }, execution, { highStakesDomain: false });

    assert.equal(validation.ok, false);
    assert.match(validation.issues.join(','), /unsupported_numbers/);
});

test('validateGroundedPayload rejects citations to unavailable tools', () => {
    const execution = {
        toolResults: [{
            toolId: 'get_recent_activity',
            result: {
                data: {
                    invoices: []
                },
                meta: {
                    source: 'invoices+payments+expenses',
                    generated_at: '2026-04-07T00:00:00.000Z'
                }
            }
        }]
    };

    const validation = aiService.validateGroundedPayload({
        summary: 'No recent invoices were found.',
        bullets: [{
            text: 'Activity is quiet.',
            citations: [{ tool: 'get_dashboard_snapshot' }]
        }],
        next_action: 'Check if expected invoices were issued.',
        citations: [{ tool: 'get_dashboard_snapshot' }],
        verification_status: 'grounded'
    }, execution, { highStakesDomain: false });

    assert.equal(validation.ok, false);
    assert.match(validation.issues.join(','), /invalid_top_level_citation|invalid_bullet_citation/);
});

test('validateAuditPayload rejects unsupported numeric claims in suggestions', () => {
    const validation = aiService.validateAuditPayload({
        riskScore: 60,
        suggestions: ['Incorrect GST appears to be 99999.']
    }, {
        total: 1200,
        tax: 216
    });

    assert.equal(validation.ok, false);
    assert.match(validation.issues.join(','), /unsupported_numbers/);
});

test('validateCollectionDraftPayload rejects unsupported numeric claims', () => {
    const validation = aiService.validateCollectionDraftPayload({
        subject: 'Invoice follow-up for 99999',
        body: 'Please clear 99999 immediately.',
        discountOffered: false
    }, {
        invoiceNumber: 'INV-1',
        total: 1200,
        amount_paid: 0
    });

    assert.equal(validation.ok, false);
    assert.match(validation.issues.join(','), /unsupported_numbers/);
});

test('validateCommandPayload accepts supported create_customer action', () => {
    const validation = aiService.validateCommandPayload({
        type: 'create_customer',
        message: 'Create this customer.',
        data: {
            name: 'Acme Labs',
            email: 'hello@acme.test'
        }
    });

    assert.equal(validation.ok, true);
});

test('tool planner falls back to dashboard snapshot for unmatched workspace finance questions', async () => {
    const plan = await aiToolRegistryService.planTools('How is my workspace doing overall?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_invoice_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_payment_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_expense_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_compliance_workspace'), true);
});

test('tool planner maps runway questions to dashboard snapshot without forcing all workspaces', async () => {
    const plan = await aiToolRegistryService.planTools('What is my estimated cash runway based on current trends?', {
        organizationId: 'org_123'
    });

    assert.deepEqual(plan.map((entry) => entry.toolId), ['get_dashboard_snapshot']);
});

test('tool planner maps broad business focus questions to personalized finance workspaces', async () => {
    const plan = await aiToolRegistryService.planTools('What should I focus on in my business this week?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_business_advisor_context'), true);
});

test('tool planner maps recent business activity questions to recent activity tool', async () => {
    const plan = await aiToolRegistryService.planTools('What happened recently in the business?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_business_advisor_context'), true);
});

test('tool planner maps invoice questions to invoice workspace', async () => {
    const plan = await aiToolRegistryService.planTools('Which invoices are overdue right now?', {
        organizationId: 'org_123'
    });

    assert.deepEqual(plan.map((entry) => entry.toolId), ['get_invoice_workspace']);
});

test('tool planner does not fetch invoice workspace for invoice creation help intent', async () => {
    const plan = await aiToolRegistryService.planTools('Can you help me create invoices?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_invoice_workspace'), false);
});

test('tool planner maps payment and expense questions to both workspaces', async () => {
    const plan = await aiToolRegistryService.planTools('Show my recent payments and expenses.', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_payment_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_expense_workspace'), true);
});

test('tool planner maps compliance questions to compliance workspace', async () => {
    const plan = await aiToolRegistryService.planTools('What compliance tasks are due this week?', {
        organizationId: 'org_123'
    });

    assert.deepEqual(plan.map((entry) => entry.toolId), ['get_compliance_workspace']);
});

test('tool planner maps natural receivables phrasing to invoice workspace', async () => {
    const plan = await aiToolRegistryService.planTools('Who still owes me money?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_invoice_workspace'), true);
});

test('tool planner maps money received phrasing to payment workspace', async () => {
    const plan = await aiToolRegistryService.planTools('How much money did we receive this week?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_payment_workspace'), true);
});

test('tool planner maps supplier spend phrasing to expense workspace', async () => {
    const plan = await aiToolRegistryService.planTools('Show me supplier spend and operating costs.', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_expense_workspace'), true);
});

test('tool planner maps gst filing phrasing to compliance workspace', async () => {
    const plan = await aiToolRegistryService.planTools('What GST filing deadlines are coming up?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_compliance_workspace'), true);
});

test('tool planner maps monthly expenses phrasing to expense workspace only', async () => {
    const plan = await aiToolRegistryService.planTools('What are my monthly expenses?', {
        organizationId: 'org_123'
    });

    assert.deepEqual(plan.map((entry) => entry.toolId), ['get_expense_workspace']);
});

test('tool planner does not treat general GST rules questions as workspace compliance lookups', async () => {
    const plan = await aiToolRegistryService.planTools('What are the GST rules I must be aware of if I am a freelancer?', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_compliance_workspace'), false);
});

test('tool planner maps overview phrasing to all four workspaces', async () => {
    const plan = await aiToolRegistryService.planTools('Give me a full overview of everything.', {
        organizationId: 'org_123'
    });

    assert.equal(plan.some((entry) => entry.toolId === 'get_invoice_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_payment_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_expense_workspace'), true);
    assert.equal(plan.some((entry) => entry.toolId === 'get_compliance_workspace'), true);
});

test('validateAgentPayload rejects unsupported numeric claims', () => {
    const validation = aiService.validateAgentPayload({
        text: 'Send a reminder mentioning 99999 due today.'
    }, {
        stats: {
            pendingPayments: 42000
        },
        invoices: []
    });

    assert.equal(validation.ok, false);
    assert.match(validation.issues.join(','), /unsupported_numbers/);
});

test('action registry suggests opening invoice flow for invoice creation help intent', () => {
    const action = aiActionRegistryService.suggestAction('Can you help me create invoices?', {}, { traceId: 'trace_123' });

    assert.equal(action?.type, 'open_invoice_modal');
    assert.equal(action?.requiresConfirmation, true);
});
