# Vercel migration acceptance

The production backend and Supabase runtime database are reachable. Deployed login, session restoration, owned-project reads and logout passed on 2026-10-07. Airtable remains the account/content store; Supabase coordinates runtime state. Background generation, scheduling and restart/replay acceptance remain open. See the dated evidence below and [VERCEL_MIGRATION.md](VERCEL_MIGRATION.md) for configuration.

Before closing deployed verification, confirm:
1. The deployed /health is 200 and logged-out /api/auth/me is 401.
2. Login survives fresh function instances; logout revokes the shared session. Cloud sessions persist across instance restarts, unlike the legacy local sessions described below.
3. A scoped idea/script job returns 202 promptly and progresses through durable Workflow steps. Successful items are reused; failed or cancelled Workflows expose unfinished work for retry.
4. A weekly schedule produces one occurrence after an edit/cold start, preserves its saved timezone, and does not duplicate a completed occurrence.
5. One explicitly authorized approval job writes a usable storyboard and completes its Script status. Direct Airtable approval discovery respects STORYBOARD_POLL_MS.
6. Record the deployed version, Workflow run IDs, project/content identities and quota/write effects without credentials.

Historical boundary: initial local implementation did not provision or deploy the cloud runtime. Supabase provisioning and deployed access were subsequently verified in the dated sections below. The earlier persistent-server plan uses filesystem/session-revocation expectations that apply only to the legacy local runtime.

---

# Historical persistent-server acceptance plan

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

## Deployed access verification — 2026-10-07

The owner confirmed successful application login and project loading on https://storyboard-automation-project-1lghl2ogq-ranz-s-projects.vercel.app/. That immutable URL redirects unauthenticated external probes to Vercel authentication (302), so its authenticated UI result is owner-reported.

Independent read-only checks against https://storyboard-automation-project.vercel.app confirmed /health HTTP 200 with {"ok":true} and logged-out /api/auth/me HTTP 401 with "Please log in". The production backend is now reachable and passes its database/schema readiness check, replacing the earlier Vercel 404 behavior.

Background Workflow execution, live content generation, schedules, storyboard completion and restart/replay behavior still need deployed acceptance evidence. These probes did not authenticate an application account, launch workflows, call Gemini, write Airtable content or send Telegram alerts.

## Deployed live-account verification — 2026-10-07

Using LIVE_USER/LIVE_PASS without logging their values, the production app passed login (200), two authenticated session restores (200), owned-project/statistics reads (200), run history (200), schedule reads (200), logout (200), and rejection of the revoked session (401). The test's newly issued cookie remained in memory and was revoked after the checks.

The first owned page contains the dedicated project "Codex live check 8f4f936f" (recQk9DQQODeGqDzy), with zero ideas/scripts/storyboards and schedule disabled. History was empty; successful history reads do not prove background persistence yet. Another project page is available.

Evidence: data/deployed-account-verification.json (only sanitized check results, no credentials/cookies). No generation job, schedule change, Airtable content write or Telegram alert was triggered. Approval for a one-concept deployed pipeline test is pending because previous live authorization was local-output-only.


## Seven-item completion audit — 2026-10-07

Completion is not yet proven. The production read-only account evidence is current; mocked tests and local process tests do not prove deployed provider effects or Vercel restarts.

| Goal item | Current evidence | Remaining acceptance boundary |
| --- | --- | --- |
| 1. Interrupted-run retry buttons | client/src/App.jsx renders resume for interrupted script runs, suppresses repeated retries through recoveredByRunId; tests/scriptRunController.test.js and tests/ui/dashboard.spec.js cover unfinished-only resume. Cloud state tests cover retry links across adapter instances. | Exercise a genuinely interrupted deployed workflow and confirm the dashboard resumes only unfinished identities. |
| 2. Throttle authentication/Airtable reads | tests/http.test.js covers rejecting writes before authentication reads and independent read limits. src/vercel.js injects shared database limits and sessions. Deployed login/session/read/logout checks passed. | No production flood or deliberate quota exhaustion was performed. |
| 3. Storyboard reuse and usability | Shared src/storyboardWorker.js is used by local and cloud execution. tests/storyboardPipeline.test.js covers unusable/wrong-identity output regeneration; tests/activity.test.js covers saved-output reuse after status-write failure. | An approved deployed script must produce one usable storyboard and complete status; ambiguous production effects remain untested. |
| 4. Shared run/schedule coordination | src/cloud/state.js and coordination.js use PostgreSQL transactions/leases. Supabase schema and verified TLS passed. tests/cloud.test.js covers cross-instance state, retries, occurrence identity and capacity; tests/sharedState.test.js covers actual local processes. | Cloud adapter tests use a test database implementation. Actual Vercel workflow restart/reconciliation and schedule occurrence replay need deployed evidence. |
| 5. Pagination beyond 50 | tests/airtable.test.js covers bounded, scoped cursors; browser test reaches project/idea 51 and preserves selections across pages. Current synthetic benchmark validates 50-project responses with 1,000 owned projects. | Production account reports another project page, but has not supplied live 51-item UI acceptance evidence. |
| 6. Storyboard/recovery activity | tests/activity.test.js proves project-owned local STORYBOARD and RECOVERY entries, including failures and reused outputs. Cloud storyboard jobs persist run activity through src/cloud/workflows.js. | The dashboard Recover drafts action now submits the shared script controller with RECOVERY source, persisted by CloudState and preserved on retries. Browser and isolated cloud-state checks cover this path. The new source must be redeployed before live cloud recovery/storyboard activity can be verified; standalone operator recovery retains local state. |
| 7. Live validation/fallback/load/restart | Prior local live Gemini validation evidence is retained. Refreshed 44 focused tests passed; current synthetic load passed at 321.46 MB peak RSS. Live account verification passed. | Deployed generation, primary/fallback/key behavior and restart/replay remain unverified. Do not intentionally exhaust provider quota to demonstrate rotation. |

Focused check: node --test tests/gemini.test.js tests/auth.test.js tests/activity.test.js tests/scriptWorker.test.js tests/storyboardPipeline.test.js tests/cloud.test.js — 44 passed, zero failed. Evidence: data/goal-focused-audit.log.

Load check: node scripts/benchmark-dashboard.mjs — passed. It used mocked providers and isolated local JSON state, 1,000 owned projects, 1,000 ideas and 500 scripts per project, and 20 concurrent history polls. A 50-project statistics page consumed 750 provider pages / 75,000 rows, with at most 100 rows per page. Peak RSS was 321.46 MB; concurrent history p95 was 898.5 ms. The benchmark ran alongside the focused suite, so latency includes CPU contention. This is neither real provider quota evidence nor a Supabase/Vercel latency measurement. Evidence: data/hardening-benchmark.json.

The one-concept deployed write test is awaiting explicit approval. Until then, do not start generation, change schedules or approve content solely for verification.

## Cloud recovery activity fix — 2026-10-07

The project dashboard now offers Recover drafts, submitting POST /api/projects/:id/recovery-runs with a bounded count through the existing script controller. Owned-project and active-project checks, request throttling, eligible Draft/blank scans, sequential processing, validation and saved-script reuse are inherited from that path. Shared history records SCRIPTS / RECOVERY, and local/cloud retries retain the recovery source. The standalone operator CLI and its activity remain supported.

Regression checks first reproduced the missing recovery endpoint and lost recovery source on retry. Final checks passed: 157 backend tests, six browser workflows, syntax checks for all changed backend files, git diff --check, and npm run test:vercel (including emitted routing/API/workflow-handler checks). Browser coverage exercises the recovery button and visible activity while retaining the standalone recovery alert check. All providers were mocked; no live generation or content writes occurred.

Evidence: data/recovery-suite.log, data/recovery-ui.log and data/recovery-vercel.log. The source is ready for redeployment but was not committed, pushed or deployed by Codex. Deployed live generation and restart/replay acceptance remain open, with the pending one-concept write authorization unchanged.
