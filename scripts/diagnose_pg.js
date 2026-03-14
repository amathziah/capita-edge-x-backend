import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';
dotenv.config();

// Since DATABASE_URL in .env is a placeholder, we might need to construct it
// or use the environment variables if they are set in the shell.
// However, the user's .env has VITE_SUPABASE_URL.
// The Supabase connection string format is: postgres://postgres.[PROJECT_REF]:[PASSWORD]@[HOST]:5432/postgres

async function getColumns() {
    const projectRef = 'enlswcufkjoemxtjtgiu';
    const password = process.env.SUPABASE_DB_PASSWORD || 'ghavqlqjmlfjldg'; // Attempting to use SMTP_PASS as a guess if not set, or placeholder
    const host = `db.${projectRef}.supabase.co`;
    
    // If DATABASE_URL is not actually a placeholder in the real environment, use it.
    const connectionString = process.env.DATABASE_URL.includes('user:password') 
        ? `postgres://postgres.${projectRef}:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
        : process.env.DATABASE_URL;

    console.log("Connecting with string (redacted password):", connectionString.replace(/:[^@]+@/, ':****@'));

    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        const tables = ['invoices', 'business_personas', 'profiles'];
        
        for (const table of tables) {
            console.log(`\n--- Columns for table: ${table} ---`);
            const res = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position;
            `, [table]);
            
            if (res.rows.length === 0) {
                console.log(`Table '${table}' not found or has no columns in information_schema.`);
            } else {
                console.table(res.rows);
            }
        }
        
    } catch (err) {
        console.error("Connection failed:", err.message);
    } finally {
        await client.end();
    }
}

getColumns();
