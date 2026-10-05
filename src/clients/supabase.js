import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

let client;
// Optional server-side Data API client. Runtime transactions use DATABASE_URL
// through src/cloud/database.js, not this publishable-key client.
export function supabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
