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

CREATE TABLE IF NOT EXISTS app_project_briefs (project_key text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS app_item_briefs (project_key text NOT NULL, item_id text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(project_key,item_id));


CREATE TABLE IF NOT EXISTS app_creation_jobs (
 id uuid PRIMARY KEY, project_id text NOT NULL, request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
 UNIQUE(project_id,request_id)
);
CREATE INDEX IF NOT EXISTS app_creation_jobs_project ON app_creation_jobs(project_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS app_creation_jobs_status ON app_creation_jobs((payload->>'status'),created_at);
CREATE TABLE IF NOT EXISTS app_blueprints (
 id uuid PRIMARY KEY, project_id text NOT NULL, family_id uuid NOT NULL, version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL,
 UNIQUE(project_id,family_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_blueprint_analysis ON app_blueprints(project_id,(payload#>>'{source,jobId}')) WHERE payload#>>'{source,jobId}' IS NOT NULL;
CREATE TABLE IF NOT EXISTS app_audit_enrollments (
 id text PRIMARY KEY, project_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS app_audits (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE, project_id text NOT NULL, script_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS app_audits_source ON app_audits(project_id,script_id,sequence DESC);
CREATE INDEX IF NOT EXISTS app_audits_fingerprint ON app_audits(project_id,script_id,(payload->>'fingerprint'));
CREATE INDEX IF NOT EXISTS app_audits_status ON app_audits((payload->>'status'),created_at);

-- Runtime state is server-only. No browser/Data API policies are granted.
-- Supabase's postgres connection can access these tables; public clients cannot.
DO $runtime_security$
DECLARE
 runtime_table text;
 client_role text;
BEGIN
 FOREACH runtime_table IN ARRAY ARRAY['app_runs','app_schedules','app_sessions','app_leases','app_rate_limits','app_key_slots','app_effects','app_maintenance','app_project_briefs','app_item_briefs','app_creation_jobs','app_blueprints','app_audit_enrollments','app_audits']
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
