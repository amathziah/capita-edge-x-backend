import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
    const dbUrl = process.env.DATABASE_URL;

    if (!dbUrl) {
        console.error('❌ DATABASE_URL environment variable is missing.');
        console.error('   Add DATABASE_URL=postgres://... to capita-edgex-backend/.env');
        process.exit(1);
    }

    const client = new Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('✅ Connected to Database via PG');

        const fullPath = path.join(__dirname, '../sql/migrations/20260407_create_ai_tool_traces.sql');
        const sql = fs.readFileSync(fullPath, 'utf8');
        await client.query(sql);

        console.log('✅ AI trace migration applied successfully.');
    } catch (error) {
        console.error('❌ AI trace migration failed:', error?.message || error);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
