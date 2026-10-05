# Code review and hardening ? 2026-10-03

The seven implementation findings from the earlier review have been addressed. Local verification is complete for the implemented fixes. The broader production goal remains open because deployment, reliable repair of complex live scripts, rendered output and real provider load are not established.

## Implemented fixes

| Original finding | Result and evidence |
| --- | --- |
| Interrupted runs lacked a retry button | React displays resume for unfinished interrupted script runs and links recovered replacements. ScriptRunController creates retries atomically and idempotently. Browser cases cover before-first-item, mid-item and between-items interruptions. The real local restart test resumes one unfinished idea and retains the successful script. |
| Authentication read Airtable before throttling | Local session validation and account-scoped limits precede external authentication, including /api/auth/me. A 200/429/429 reproduction now performs one Users read. Accepted requests still recheck revocation; tests include spoofed forwarding headers, CSRF and lookup failures. |
| Storyboard completion repeated generation | src/storyboardWorker.js locks video identity and refreshes Script status. It reuses usable persisted output after lost responses/status failures. Mocked ambiguous-write tests and actual two-process worker tests observe one generation and one write. |
| Run/schedule snapshots lost concurrent writes | src/utils/jsonStateFile.js provides synchronous same-host fresh-read transactions, atomic replacement and process ownership. Two Node processes preserve all independent entries and claim one scheduled occurrence. Scheduler recovery follows replacement chains, including manual resumes. Abandoned state locks fail closed; explicit recovery requires stopped servers. |
| Empty storyboard output advanced status | A separate usability gate requires at least one frame/panel and image/panel plus video prompts for every provided entry. Empty and promptless output is rejected before persistence. Optional structures, forgiving schemas and original n8n prompts remain intact. |
| Projects/ideas stopped at 50 | Bounded cursor APIs and next/previous React controls reach record 51. Browser coverage selects ideas on separate pages and generates exactly those two. Selection is capped at 50; ownership remains enforced. |
| Storyboard/recovery activity was absent | Shared pipelines persist project-owned success/reuse/failure activity. HTTP/browser and pipeline checks cover visibility and account isolation. Legacy records without a resolvable project cannot safely produce account-visible activity. |

## Verification

- Final npm.cmd run test:all passed **141 backend tests**, the production Vite build and **six Playwright browser tests**. External services in these suites are mocked. Evidence: data/hardening-tests.log.
- Complete Gemini-client tests cover primary success, bounded transient 503 retries, fallback, 429 key rotation, unavailable-model termination and malformed/empty responses. This exceeds the earlier helper-only coverage.
- A read-only live ListModels check found both configured identifiers with generateContent support. The check uses the provider's [Models API](https://ai.google.dev/api/models), prints model names only and stores local metadata in data/hardening-models.json. Configuration is still loaded at startup; restart after .env edits.
- Live Gemini verification captured an invalid newly generated script and one bounded correction. Both failed deterministic timing validation and persisted zero Scripts. The validator now handles observed root/nested review metadata and gives malformed reviews one bounded correction opportunity without inferring approval.
- A compliant control passed a real Gemini validation call, saved once to the local stub and reused on replay. **Control generation was mocked**, so this does not prove successful repair of complex generated content. The primary returned 503 on three attempts and fallback completed review. No 429 was observed in these scoped calls. Artifacts are the data/hardening-live-script* JSON files.
- The synthetic dashboard benchmark modeled 1,000 owned projects, 1,000 ideas and 500 scripts per project, and 200 runs with 50 large error items each. Peak RSS was about **315 MB**, the run snapshot about **11.6 MB**, and sequential history p95 about **151 ms**. Four concurrent tabs across five waves produced request p95 about **509 ms** and event-loop p95 about **432 ms**, with a simulated 20 ms account-read delay and the default API read limiter. One 50-project statistics page consumed **750 provider pages / 75,000 rows**. Provider latency and quotas were mocked. Forty accepted sequential/concurrent history polls still made forty Users reads. Evidence: data/hardening-benchmark.json.
- A real local Express child process was stopped after saving its first script, then restarted. Old sessions were rejected; a fresh login resumed only the unfinished idea. The isolated test simulated expiry of the abandoned script lock; production retains its ten-minute lease. Saved scripts: two; generation attempts including the aborted call: three. Evidence: data/hardening-local-restart.json.
- No live Airtable writes or Telegram sends were performed for this hardening verification. Earlier approved live lifecycle checks are historical and predate script validation. No commit, push or deployment was made; existing user changes were preserved.

## Remaining boundaries

1. **Deployment:** the React frontend is published on Vercel, but the latest read-only checks return 404 NOT_FOUND for /health and /api/auth/me. The login endpoint also returned 404 in the earlier invalid-body probe. API deployment/routing must be established before verifying deployed sessions, persistence or restarts. The current JSON stores, in-memory sessions/queue and interval scheduler require a persistent Node backend or adaptation for Vercel functions.
2. **Live output quality:** complex generated output still failed repair. Deterministic rejection works; actual TTS timing, visual quality and rendered video alignment need separate verification.
3. **Provider load:** statistics correctness is preserved, but the measured request count is expensive. Mocked timing and memory do not prove real Airtable latency/quota behavior or simultaneous provider load.
4. **Multiple processes:** JSON coordination supports processes on the same host sharing configured paths. It does not coordinate process-local queues, sessions or Gemini cooldowns. Cross-host deployment requires a database and a shared session/limit strategy. Active/unresolved runs may exceed the normal retention target.
5. **Broad production gates:** alternate Airtable schemas, live failure-alert delivery and the final post-validation lifecycle remain unverified.

README.md, AGENTS.md, CLAUDE.md and GOAL.md document these behaviors and limits. Statistics counts, scalar project keys, schedule edit/re-enable behavior and the React migration are resolved rather than pending defects.

Deployment acceptance steps and required evidence are preserved in [DEPLOYMENT_VERIFICATION.md](DEPLOYMENT_VERIFICATION.md).

## Full Vercel migration — local evidence (2026-10-05)

- React plus the Express API now build through Nitro to Vercel Build Output API, including Workflow queue/webhook routing. Runtime provider prompts and agents remain Gemini-based.
- PostgreSQL replaces cloud JSON stores, process-local sessions, quotas, queues and filesystem locks. Durable Workflow sleeps implement cooldowns/weekly schedules, with first-owner claims, occurrence uniqueness, outbox reconciliation and interrupted-run recovery.
- Official YouTube Data API replaces local yt-dlp for cloud metadata. Local operator execution retains yt-dlp.
- Added safe opt-in import of local history/schedules; original cloud rows win and active local runs become Interrupted.
- Final backend suite: **155 passed**. Cloud-specific coverage uses real isolated PostgreSQL through PGlite with mocked providers. Browser suite: **6 passed**. A first full run hit the existing restart test timeout while repeatedly starting PostgreSQL engines; reusing one isolated test engine removed the resource contention, and the full suite plus final backend run passed.
- Full Vercel build and isolated emitted-handler checks passed: static routing, Workflow queue trigger, missing-database 503, unauthorized cron 401, invalid-method cron 405. These are local artifact checks, not deployed endpoint verification.
- npm audit reports **0 vulnerabilities** after compatible overrides for devalue, nanoid and qs. Credential scanning across 93 deployment files found none of the nine configured credential values.
- PostgreSQL provisioning, schema application, new Vercel environment variables, redeployment and live cloud acceptance remain pending. No new live provider calls, Airtable writes or Telegram messages were made for this migration. No commit or push was made.

## Supabase runtime setup — 2026-10-06

The supplied SUPABASE_POOLER PostgreSQL URI is supported as an alternative to DATABASE_URL (DATABASE_URL takes precedence). Migration was applied successfully to the configured Supabase project. All eight app_* tables were verified present, empty, with RLS enabled and SELECT denied to anon/authenticated. Client TLS was encrypted and its certificate verified using Supabase's public Root 2021 CA, bundled for serverless execution.

A local cloud API connected to the real Supabase database returned /health 200 and logged-out /api/auth/me 401. This was a read-only readiness check; no Gemini calls, Airtable changes, Telegram messages or local-history imports occurred.

Final backend suite: 156 passed. Vercel build and emitted-handler checks passed. npm audit: zero vulnerabilities. An existing restart-test race was corrected by waiting for the fixture's second provider call before terminating the worker, rather than treating lock creation as proof that generation began.

Supabase's optional Node Data API client now loads environment variables via process.env and initializes lazily, with SDK dependency installed. It does not replace the SQL transaction adapter or Airtable authentication/content.

Still pending: configure SUPABASE_POOLER in Vercel if not already present, redeploy the modified source and perform deployed acceptance checks. No commit or push was made.
