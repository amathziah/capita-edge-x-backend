import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

// Helper to get connection string
const getConnectionString = () => {
    // 1. Check for explicit DATABASE_URL
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

    // 2. Try to construct from Supabase Config (if standard format)
    // Format: postgres://postgres:[PASSWORD]@[HOST]:5432/postgres
    // We likely don't have the password in .env for security, so we might need to ask the user.
    if (process.env.SUPABASE_DB_PASSWORD && process.env.VITE_SUPABASE_URL) {
        // Extract project ref from URL "https://[REF].supabase.co"
        const projectRef = process.env.VITE_SUPABASE_URL.split('//')[1].split('.')[0];
        return `postgres://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`;
    }

    return null;
};

async function runMigration() {
    const connectionString = getConnectionString();

    if (!connectionString) {
        console.error('❌ Error: Missing DATABASE_URL.');
        console.error('To run this migration locally, you must provide the Direct Connection String to your Supabase DB.');
        console.error('Please add DATABASE_URL="postgres://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres" to your server/.env file.');
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Required for Supabase
    });

    try {
        await client.connect();
        console.log('✅ Connected to Database');

        // Read the migration file
        const migrationPath = path.join(__dirname, '../../supabase/fix_schema_and_rls.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log(`Running migration from: ${migrationPath}`);

        // Execute the SQL
        await client.query(sql);

        console.log('✅ Migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        if (err.position) {
            console.error(`Position: ${err.position}`);
        }
    } finally {
        await client.end();
    }
}

runMigration();
