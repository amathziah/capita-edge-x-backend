import pg from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('📡 Connected to PostgreSQL database...');

    const sql = fs.readFileSync('supabase/migrations/20260404_auth_search.sql', 'utf8');
    await client.query(sql);
    
    console.log('✅ Migration successful: RPC get_user_by_email_v2 created.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
