import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key';

const { supabase } = await import('../src/core/database/supabase.js');
const reportController = await import('../src/modules/reports/report.controller.js');
const customerController = await import('../src/modules/customers/customer.controller.js');
const invoiceController = await import('../src/modules/invoices/invoice.controller.js');
const paymentController = await import('../src/modules/payments/payment.controller.js');
const analyticsController = await import('../src/modules/analytics/analytics.controller.js');
const analyticsService = (await import('../src/modules/analytics/analytics.service.js')).default;
const complianceController = await import('../src/modules/compliance/compliance.controller.js');
const notificationController = await import('../src/modules/notifications/notification.controller.js');
const systemController = await import('../src/modules/system/system.controller.js');
const emailService = (await import('../src/core/services/email.service.js')).default;
const { APIError } = await import('../src/core/middleware/errorHandler.js');

function createResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        setHeader(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        }
    };
}

function createQueryBuilder(result, recorder) {
    return {
        select(...args) {
            recorder.selects.push(args);
            return this;
        },
        eq(column, value) {
            recorder.eqs.push([column, value]);
            return this;
        },
        in(column, values) {
            recorder.ins ??= [];
            recorder.ins.push([column, values]);
            return this;
        },
        lt(column, value) {
            recorder.lts ??= [];
            recorder.lts.push([column, value]);
            return this;
        },
        lte(column, value) {
            recorder.ltes ??= [];
            recorder.ltes.push([column, value]);
            return this;
        },
        gte(column, value) {
            recorder.gtes ??= [];
            recorder.gtes.push([column, value]);
            return this;
        },
        order(...args) {
            recorder.orders.push(args);
            return this;
        },
        limit(value) {
            recorder.limits ??= [];
            recorder.limits.push(value);
            return Promise.resolve(result);
        },
        range(...args) {
            recorder.ranges.push(args);
            return Promise.resolve(result);
        },
        insert(payload) {
            recorder.inserts.push(payload);
            return this;
        },
        upsert(payload) {
            recorder.upserts ??= [];
            recorder.upserts.push(payload);
            return this;
        },
        update(payload) {
            recorder.updates.push(payload);
            return this;
        },
        delete() {
            recorder.deleted = true;
            return this;
        },
        single() {
            return Promise.resolve(result);
        },
        maybeSingle() {
            return Promise.resolve(result);
        },
        then(resolve, reject) {
            return Promise.resolve(result).then(resolve, reject);
        }
    };
}

function withMockedFrom(sequence, run) {
    const originalFrom = supabase.from;
    const calls = [];
    let index = 0;

    supabase.from = (table) => {
        calls.push(table);
        const next = sequence[index++];
        assert.ok(next, `Unexpected supabase.from("${table}") call`);
        assert.equal(table, next.table);
        return createQueryBuilder(next.result, next.recorder);
    };

    return Promise.resolve()
        .then(() => run({ calls }))
        .finally(() => {
            supabase.from = originalFrom;
        });
}

function withMockedRpc(implementation, run) {
    const originalRpc = supabase.rpc;
    supabase.rpc = implementation;
    return Promise.resolve()
        .then(run)
        .finally(() => {
            supabase.rpc = originalRpc;
        });
}

test('reports read uses authenticated organization instead of request header', async () => {
    const recorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        user: { organizationId: 'org-authenticated' },
        headers: { 'x-organization-id': 'org-spoofed' }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'platform_reports',
            recorder,
            result: { data: [{ id: 'r1' }], error: null }
        }
    ], async () => {
        await reportController.getReports(req, res);
    });

    assert.deepEqual(recorder.eqs, [['organization_id', 'org-authenticated']]);
    assert.deepEqual(res.body, [{ id: 'r1' }]);
});

test('customer lookup includes organization filter', async () => {
    const recorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        params: { id: 'cust-1' },
        user: { organizationId: 'org-1' }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'customers',
            recorder,
            result: { data: { id: 'cust-1' }, error: null }
        }
    ], async () => {
        await customerController.getCustomerById(req, res);
    });

    assert.deepEqual(recorder.eqs, [
        ['id', 'cust-1'],
        ['organization_id', 'org-1']
    ]);
    assert.deepEqual(res.body, { id: 'cust-1' });
});

test('invoice lookup includes organization filter', async () => {
    const recorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        params: { id: 'inv-1' },
        user: { organizationId: 'org-2' }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'invoices',
            recorder,
            result: { data: { id: 'inv-1', items: [] }, error: null }
        }
    ], async () => {
        await invoiceController.getInvoiceById(req, res);
    });

    assert.deepEqual(recorder.eqs, [
        ['id', 'inv-1'],
        ['organization_id', 'org-2']
    ]);
    assert.equal(res.body.id, 'inv-1');
});

test('createPayment rejects invoices outside the authenticated organization before insert', async () => {
    const invoiceRecorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const paymentRecorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        body: {
            invoiceId: 'inv-cross-tenant',
            amount: 1000,
            method: 'upi'
        },
        user: { organizationId: 'org-safe', id: 'user-1' }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'invoices',
            recorder: invoiceRecorder,
            result: { data: null, error: { message: 'Row not found' } }
        },
        {
            table: 'payments',
            recorder: paymentRecorder,
            result: { data: null, error: null }
        }
    ], async () => {
        await assert.rejects(
            () => paymentController.createPayment(req, res),
            (error) => error instanceof APIError && error.statusCode === 404
        );
    });

    assert.deepEqual(invoiceRecorder.eqs, [
        ['id', 'inv-cross-tenant'],
        ['organization_id', 'org-safe']
    ]);
    assert.equal(paymentRecorder.inserts.length, 0);
});

test('downloadReceipt loads linked invoice with organization filter', async () => {
    const paymentQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const invoiceQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const configQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        params: { paymentId: 'pay-1' },
        user: { organizationId: 'org-3' }
    };
    const res = {
        download(_path, _filename, cb) {
            cb?.();
        }
    };

    const pdfService = await import('../src/modules/invoices/pdf.service.js');
    const originalGetTempReceiptPath = pdfService.default.getTempReceiptPath;
    const originalGenerateReceiptPDF = pdfService.default.generateReceiptPDF;
    const originalCleanupPDF = pdfService.default.cleanupPDF;

    pdfService.default.getTempReceiptPath = () => '/tmp/receipt.pdf';
    pdfService.default.generateReceiptPDF = async () => {};
    pdfService.default.cleanupPDF = () => {};

    try {
        await withMockedFrom([
            {
                table: 'payments',
                recorder: paymentQuery,
                result: { data: { id: 'pay-1', invoiceId: 'inv-3' }, error: null }
            },
            {
                table: 'invoices',
                recorder: invoiceQuery,
                result: { data: { id: 'inv-3', invoiceNumber: 'INV-3' }, error: null }
            },
            {
                table: 'organization_configs',
                recorder: configQuery,
                result: { data: {}, error: null }
            }
        ], async () => {
            await paymentController.downloadReceipt(req, res);
        });
    } finally {
        pdfService.default.getTempReceiptPath = originalGetTempReceiptPath;
        pdfService.default.generateReceiptPDF = originalGenerateReceiptPDF;
        pdfService.default.cleanupPDF = originalCleanupPDF;
    }

    assert.deepEqual(invoiceQuery.eqs, [
        ['id', 'inv-3'],
        ['organization_id', 'org-3']
    ]);
});

test('analytics dashboard stats use authenticated organization id', async () => {
    const original = analyticsService.getDashboardStats;
    let receivedOrgId = null;
    analyticsService.getDashboardStats = async (orgId) => {
        receivedOrgId = orgId;
        return { total_revenue: 100 };
    };

    const req = { user: { organizationId: 'org-analytics' } };
    const res = createResponse();

    try {
        await analyticsController.getDashboardStats(req, res);
    } finally {
        analyticsService.getDashboardStats = original;
    }

    assert.equal(receivedOrgId, 'org-analytics');
    assert.deepEqual(res.body, { total_revenue: 100 });
});

test('compliance list includes organization filter', async () => {
    const recorder = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        query: {},
        user: { organizationId: 'org-compliance' }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'compliance_tasks',
            recorder,
            result: {
                data: [{ id: 'task-1', status: 'pending', due_date: '2999-01-01' }],
                error: null,
                count: 1
            }
        }
    ], async () => {
        await complianceController.getTasks(req, res);
    });

    assert.deepEqual(recorder.eqs, [['organization_id', 'org-compliance']]);
    assert.equal(res.headers['X-Total-Count'], 1);
});

test('notifications queries are scoped to the authenticated organization', async () => {
    const invoiceQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const paymentQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const complianceQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = { user: { organizationId: 'org-notify' } };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'invoices',
            recorder: invoiceQuery,
            result: { data: [], error: null }
        },
        {
            table: 'payments',
            recorder: paymentQuery,
            result: { data: [], error: null }
        },
        {
            table: 'compliance_tasks',
            recorder: complianceQuery,
            result: { data: [], error: null }
        }
    ], async () => {
        await notificationController.getNotifications(req, res);
    });

    assert.deepEqual(invoiceQuery.eqs[0], ['organization_id', 'org-notify']);
    assert.deepEqual(paymentQuery.eqs[0], ['organization_id', 'org-notify']);
    assert.deepEqual(complianceQuery.eqs[0], ['organization_id', 'org-notify']);
});

test('system settings lookup is scoped to the authenticated organization', async () => {
    const configQuery = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = { user: { organizationId: 'org-settings' } };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'organization_configs',
            recorder: configQuery,
            result: {
                data: {
                    organization_id: 'org-settings',
                    business_name: 'Capita',
                    smtp_user: 'team@example.com',
                    inventory_settings: {}
                },
                error: null
            }
        }
    ], async () => {
        await withMockedRpc(async (_fn, args) => {
            assert.equal(args.p_organization_id, 'org-settings');
            return { data: 'secret-present', error: null };
        }, async () => {
            await systemController.getSettings(req, res);
        });
    });

    assert.deepEqual(configQuery.eqs, [['organization_id', 'org-settings']]);
    assert.equal(res.body.smtpConfigured, true);
});

test('system inventory save writes authenticated organization id', async () => {
    const queryExisting = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const queryUpsert = { eqs: [], selects: [], orders: [], ranges: [], inserts: [], updates: [] };
    const req = {
        user: { organizationId: 'org-system' },
        body: { reorder_alerts_enabled: true }
    };
    const res = createResponse();

    await withMockedFrom([
        {
            table: 'organization_configs',
            recorder: queryExisting,
            result: { data: { organization_id: 'org-system', inventory_settings: {} }, error: null }
        },
        {
            table: 'organization_configs',
            recorder: queryUpsert,
            result: { data: null, error: null }
        }
    ], async () => {
        await systemController.saveInventorySettings(req, res);
    });

    assert.deepEqual(queryExisting.eqs, [['organization_id', 'org-system']]);
    assert.deepEqual(queryUpsert.upserts, [{
        organization_id: 'org-system',
        inventory_settings: { reorder_alerts_enabled: true }
    }]);
});

test('email test connection does not touch stored org secrets and uses provided credentials only', async () => {
    const originalVerifyConnection = emailService.verifyConnection;
    let payload = null;
    emailService.verifyConnection = async (settings) => {
        payload = settings;
        return { success: true };
    };

    const req = { body: { smtp_user: 'user@example.com', smtp_pass: 'app-pass' } };
    const res = createResponse();

    try {
        await systemController.testEmailConnection(req, res);
    } finally {
        emailService.verifyConnection = originalVerifyConnection;
    }

    assert.deepEqual(payload, { smtp_user: 'user@example.com', smtp_pass: 'app-pass' });
    assert.deepEqual(res.body, { success: true });
});
