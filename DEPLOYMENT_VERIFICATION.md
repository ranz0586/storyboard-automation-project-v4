# Vercel migration acceptance

The migration source and local checks are ready. Follow [VERCEL_MIGRATION.md](VERCEL_MIGRATION.md) to provision PostgreSQL, set server-only DATABASE_URL/YOUTUBE_API_KEY/CRON_SECRET, apply the schema and redeploy with Nitro settings.

Before closing deployed verification, confirm:
1. The deployed /health is 200 and logged-out /api/auth/me is 401.
2. Login survives fresh function instances; logout revokes the shared session. Cloud sessions persist across instance restarts, unlike the legacy local sessions described below.
3. A scoped idea/script job returns 202 promptly and progresses through durable Workflow steps. Successful items are reused; failed or cancelled Workflows expose unfinished work for retry.
4. A weekly schedule produces one occurrence after an edit/cold start, preserves its saved timezone, and does not duplicate a completed occurrence.
5. One explicitly authorized approval job writes a usable storyboard and completes its Script status. Direct Airtable approval discovery respects STORYBOARD_POLL_MS.
6. Record the deployed version, Workflow run IDs, project/content identities and quota/write effects without credentials.

No cloud database was provisioned and no new version was deployed during local implementation. The tests below describe the earlier persistent-server acceptance plan; their filesystem/session-revocation expectations apply only to the legacy local runtime.

---

# Deployment verification pending

The React frontend is published at https://storyboard-automation-project.vercel.app/. The latest read-only probe returned HTTP 200 for the dashboard and Vercel 404 NOT_FOUND for both /health and /api/auth/me. The earlier invalid-body POST to /api/auth/login also returned 404. The Express backend is therefore not reachable through the frontend origin. Deployment verification now depends on connecting a backend and choosing durable storage/job execution; a published frontend is not evidence of deployed pipeline persistence. Local process restart checks remain local evidence only.

## Before the check

- Identify the deployed URL, service/process manager and persistent disk mount. Use a dedicated test account/project; record Airtable record IDs separately from the custom project key.
- Verify the built React assets are present and `/health` responds. Confirm configured model names from startup logs without exposing keys.
- Verify `RUN_STATE_PATH`, `SCHEDULE_STATE_PATH`, `SCRIPT_LOCK_DIR` and registration locks use persistent paths. Same-host processes must share these paths. Do not use the JSON stores across different hosts.
- Choose one server process for the first check. Extra processes require a deliberate session/routing plan and aggregate queue/key/quota limits; those remain process-local.
- Obtain authorization for the concrete test's Gemini calls, Airtable writes and any Telegram alerts. The live local-output authorization does not authorize a new deployment or production lifecycle writes.

## Restart and persistence check

1. Log in and create a two-idea script run in the dedicated project. Capture run ID, selected idea IDs, successful item identities and saved Script identities.
2. After the first Script is persisted, use the service's process manager to restart the test service while remaining work is in flight. Do not interrupt unrelated processes.
3. Verify `/health` and React assets recover. Confirm the previous session is rejected, then log in again. Verify saved schedules and run history survive with the original identities/counts.
4. Confirm the stopped owner's unfinished run becomes `INTERRUPTED`. Resume it from the dashboard. A crash-held script lock retains its ten-minute expiry; do not shorten or delete a live lock to make the test pass.
5. Verify the replacement requests only unfinished work, the completed Script is reused, and final Airtable counts show exactly one Script per Idea identity. Capture both original and replacement run IDs.
6. If a short JSON transaction lock was abandoned, stop every server using those files, use `node scripts/recover-state-locks.mjs --servers-stopped`, then restart. Record that recovery was required. Never run recovery while an owner remains live.

## Scheduling and storyboard check

1. Configure a weekly occurrence in the dedicated project. Verify edit/re-enable waits for the next occurrence rather than backfilling an earlier one.
2. Restart before the next due occurrence and verify the saved configuration survives. At the occurrence, verify one scheduled run is claimed. If manually resuming an interrupted scheduled run, verify the scheduler follows its replacement rather than replaying the ancestor.
3. Approve one complete Script and run the configured storyboard poller. Verify usable saved output, one Storyboard identity, `Story Generated` status and project-owned activity.
4. A status-only retry must reuse the saved storyboard. Exercise ambiguous writes/failures only in an isolated environment with controlled fault injection; local mocked coverage is not proof of those failures against a production provider.

## Evidence needed to close the goal

Record timestamps, deployed service/version, persistent path configuration (no secrets), startup/restart results, original/replacement run IDs, schedule occurrence, before/after Airtable identities/counts, activity outcomes and any observed errors/quota responses. Redact account credentials and cookie values. Until these checks are executed against an actual deployed service, deployed restart behavior remains unverified.

## Supabase runtime setup — 2026-10-06

The supplied SUPABASE_POOLER PostgreSQL URI is supported as an alternative to DATABASE_URL (DATABASE_URL takes precedence). Migration was applied successfully to the configured Supabase project. All eight app_* tables were verified present, empty, with RLS enabled and SELECT denied to anon/authenticated. Client TLS was encrypted and its certificate verified using Supabase's public Root 2021 CA, bundled for serverless execution.

A local cloud API connected to the real Supabase database returned /health 200 and logged-out /api/auth/me 401. This was a read-only readiness check; no Gemini calls, Airtable changes, Telegram messages or local-history imports occurred.

Final backend suite: 156 passed. Vercel build and emitted-handler checks passed. npm audit: zero vulnerabilities. An existing restart-test race was corrected by waiting for the fixture's second provider call before terminating the worker, rather than treating lock creation as proof that generation began.

Supabase's optional Node Data API client now loads environment variables via process.env and initializes lazily, with SDK dependency installed. It does not replace the SQL transaction adapter or Airtable authentication/content.

Still pending: configure SUPABASE_POOLER in Vercel if not already present, redeploy the modified source and perform deployed acceptance checks. No commit or push was made.
