import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const tables = [
    'organizations', 'organization_users', 'users', 'customers', 'products',
    'invoices', 'invoice_items', 'payments', 'expenses', 'ledger_entries',
    'reminders', 'compliance_tasks', 'settings', 'subscriptions', 'ai_requests'
];

async function getStructure() {
    const schema = {};

    for (const table of tables) {
        try {
            const { data, error } = await supabase.from(table).select('*').limit(1);
            if (error) {
                schema[table] = { error: error.message };
            } else if (data && data.length > 0) {
                schema[table] = { columns: Object.keys(data[0]), sample: data[0] };
            } else {
                schema[table] = { status: 'Empty (Columns could not be inferred from data)' };
            }
        } catch (err) {
            schema[table] = { error: err.message };
        }
    }

    console.log(JSON.stringify(schema, null, 2));
}

getStructure();
