
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixSettingsSchema() {
    console.log('🔧 Checking settings table schema for multi-tenancy...');

    try {
        // 1. Check if organization_id exists
        // We try to select it. If error, it doesn't exist.
        const { error: checkError } = await supabase
            .from('settings')
            .select('organization_id')
            .limit(1);

        if (checkError && checkError.message.includes('does not exist')) {
            console.error('❌ organization_id column MISSING in settings table.');
            return;
        }

        console.log('✅ organization_id column exists.');

        // 2. Test PK Constraint
        const testKey = `test_schema_check_${Date.now()}`;
        // Use real UUID format to avoid invalid input syntax for type uuid
        const org1 = '00000000-0000-0000-0000-000000000001';
        const org2 = '00000000-0000-0000-0000-000000000002';

        console.log('Testing PK constraint with key:', testKey);

        // Insert for Org 1
        const { error: err1 } = await supabase.from('settings').insert({
            key: testKey,
            value: 'val1',
            organization_id: org1
        });

        if (err1) {
            console.error('❌ Failed to insert first record:', err1.message);
            // If this fails, maybe RLS or other constraint?
            return;
        }

        // Insert for Org 2 (Should succeed if PK is composite (org_id, key), fail if PK is just user_id or key)
        // Note: The schema file said user_id default auth.uid(). Since we use service role, RLS is bypassed, but defaults might apply?
        // Service role bypasses RLS.
        const { error: err2 } = await supabase.from('settings').insert({
            key: testKey,
            value: 'val2',
            organization_id: org2
        });

        if (err2) {
            console.error('❌ PK Constraint Issue Detected:', err2.message);
            if (err2.message.includes('duplicate key value')) {
                console.log('\nREQUIRED SQL FIX:');
                console.log('--------------------------------------------------');
                console.log('ALTER TABLE settings DROP CONSTRAINT settings_pkey;');
                console.log('ALTER TABLE settings ADD PRIMARY KEY (organization_id, key);');
                console.log('--------------------------------------------------');
            }
        } else {
            console.log('✅ Settings table supports multi-tenancy correctly!');

            // Cleanup
            await supabase.from('settings').delete().eq('key', testKey);
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

fixSettingsSchema();
