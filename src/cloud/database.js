import pg from 'pg';
import { supabaseCa } from './supabaseCa.js';
let shared;
export function database() {
  let connectionString = process.env.DATABASE_URL || process.env.SUPABASE_POOLER;
  if (!connectionString)
    throw new Error('DATABASE_URL or SUPABASE_POOLER is required for the Vercel runtime');
  const uri = new URL(connectionString);
  const isSupabase = /(?:^|\.)supabase\.(?:co|com)$/.test(uri.hostname);
  // pg's connection-string SSL options overwrite an explicit CA; configure TLS together.
  if (isSupabase) {
    for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'])
      uri.searchParams.delete(name);
    connectionString = uri.toString();
  }
  return (shared ||= new Database(
    new pg.Pool({
      connectionString,
      ...(isSupabase ? { ssl: { ca: supabaseCa, rejectUnauthorized: true } } : {}),
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    }),
  ));
}
export class Database {
  constructor(pool) {
    this.pool = pool;
  }
  query(text, values = []) {
    return this.pool.query(text, values);
  }
  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
