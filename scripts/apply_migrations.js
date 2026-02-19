import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
    try {
        const dbUrl = process.env.DATABASE_URL;

        if (!dbUrl) {
            console.error('❌ DATABASE_URL environment variable is missing.');
            console.log('   Please add DATABASE_URL=postgres://... to your .env file.');
            process.exit(1);
        }

        const client = new Client({
            connectionString: dbUrl,
            ssl: { rejectUnauthorized: false }
        });

        await client.connect();
        console.log('✅ Connected to Database via PG');

        const migrations = [
            '../../supabase/migrations/enterprise_upgrade.sql',
            '../../supabase/migrations/inventory_forecasting.sql'
        ];

        for (const relPath of migrations) {
            const fullPath = path.join(__dirname, relPath);
            if (fs.existsSync(fullPath)) {
                console.log(`\n📄 Running ${path.basename(fullPath)}...`);
                const sql = fs.readFileSync(fullPath, 'utf8');
                await client.query(sql);
                console.log('   ✅ Done.');
            } else {
                console.error(`   ❌ File not found: ${fullPath}`);
            }
        }

        console.log('\n🎉 All migrations applied!');
        await client.end();
    } catch (e) {
        console.error('❌ Migration Failed:', e);
        process.exit(1);
    }
}

run();
