CREATE TABLE IF NOT EXISTS app_runs (
 id uuid PRIMARY KEY, project_id text NOT NULL, source text NOT NULL, occurrence text,
 created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_run_occurrence ON app_runs(project_id,source,occurrence) WHERE occurrence IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_runs_project ON app_runs(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS app_schedules (project_id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id text PRIMARY KEY, expires_at timestamptz NOT NULL, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS app_leases (id text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS app_rate_limits (id text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS app_key_slots (id text PRIMARY KEY, available_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS app_effects (id text PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_maintenance (id text PRIMARY KEY, owner text NOT NULL, updated_at timestamptz NOT NULL);

CREATE INDEX IF NOT EXISTS app_runs_status ON app_runs((payload->>'status'),created_at);
CREATE INDEX IF NOT EXISTS app_sessions_expiry ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS app_rate_limits_expiry ON app_rate_limits(reset_at);

-- Runtime state is server-only. No browser/Data API policies are granted.
-- Supabase's postgres connection can access these tables; public clients cannot.
DO $runtime_security$
DECLARE
 runtime_table text;
 client_role text;
BEGIN
 FOREACH runtime_table IN ARRAY ARRAY['app_runs','app_schedules','app_sessions','app_leases','app_rate_limits','app_key_slots','app_effects','app_maintenance']
 LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',runtime_table);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',runtime_table);
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated']
  LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',runtime_table,client_role);
   END IF;
  END LOOP;
 END LOOP;
END
$runtime_security$;
