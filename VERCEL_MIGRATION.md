# Vercel deployment

The React dashboard and Express APIs are deployed together by Nitro. Vercel Workflows execute idea, sequential script and storyboard jobs. PostgreSQL stores sessions, run history, schedules, request limits, key cooldowns, leases and replay checkpoints. Airtable remains the content and account database; runtime agents still use Gemini and their original prompts.

## Provision and configure

1. Connect managed PostgreSQL to the Vercel project. Use its pooled connection URL as the server-only `DATABASE_URL`. Select a database region near the function region. Give Preview deployments a separate database and provider configuration so preview jobs cannot share production state.
2. Enable YouTube Data API v3 in Google Cloud. Set server-only `YOUTUBE_API_KEY`, restricted to that API. Vercel uses official search/video metadata endpoints; it does not invoke the Windows yt-dlp executable or download videos.
3. Set `CRON_SECRET` to a random secret in Vercel. Preserve existing Gemini, Airtable and Telegram variables. Set `SESSION_COOKIE_SECURE=true` for production. No secret should have a `VITE_` prefix.
4. Enable Fluid compute for Workflow SDK. Use Node 24. The checked-in `vercel.json` sets framework Nitro, install `npm ci`, build `npm run build`, and clears the old output directory. In the dashboard, remove the old `dist` output override. The build deploys `.vercel/output`, including API and workflow queue handlers.
5. Apply the schema before deployment. From this checkout, with `DATABASE_URL` set privately in the shell or local gitignored environment:
   ```powershell
   npm ci
   npm run db:migrate
   npm run build
   ```
   The migration creates only application-owned `app_*` tables and indexes and is safe to repeat. It does not alter Airtable tables.
6. Deploy this branch through the existing Vercel Git integration. After deployment, visit `/health`: it must return HTTP 200 with `{"ok":true}`. A missing database/schema returns 503. Logged-out `/api/auth/me` must return 401, rather than Vercel's old 404.

## Preserve local history and schedules

Stop all local servers and operator jobs before switching production execution to Vercel. Back up `data/runs.json` and the configured schedule file. To import their existing state into a fresh cloud database:

```powershell
npm run db:migrate -- --import-local --servers-stopped
```

Import is opt-in, transactional and idempotent: existing cloud records win. Local unfinished runs become Interrupted and can be retried in the dashboard; they do not resume automatically. Existing weekly occurrence keys and retry links are retained. Sessions are not transferred, so sign in again. Airtable content stays in the existing base.

Do not keep the local scheduler/poller running against the same production Airtable base after cutover: local filesystem locks and cloud database leases do not coordinate with one another.

## Background execution

HTTP endpoints persist queued work and enqueue a Workflow; the request does not wait for generation. Model calls are checkpointed by run/item and request content. Deferred cooldowns release execution slots and use durable Workflow sleeps, keeping Gemini quotas shared across function instances.

Weekly schedules have one owning Workflow per configuration generation, unique occurrence records, and durable sleeps until the configured local time. Changing/disabling a schedule retires its previous workflow when it wakes. The daily authenticated `/api/cron` is a recovery backstop, not the weekly timing engine. It is compatible with the daily cron schedule in `vercel.json`. Maintenance reconciles lost dispatches and exposes failed/cancelled jobs as Interrupted.

Use **Recover drafts** in a project to process Draft or blank-status ideas up to the script count entered above. This submits the existing sequential script workflow with source `RECOVERY`, so completion, failures and retries appear in shared dashboard activity. Saved scripts are reused. The standalone `npm run recover-ideas` command continues to use local state; after cloud cutover, use the dashboard action.

Dashboard approval queues a storyboard immediately. Set `STORYBOARD_POLL_MS=900000` to also discover approvals made directly in Airtable every fifteen minutes. Set 0 to disable that discovery. Failed storyboard occurrences can retry on a later poll or repeated approval; persisted usable output is reused.

Gemini cooldowns reduce bursts, but do not guarantee avoiding provider quota limits. YouTube API quotas and Workflow/database usage still apply. Telegram error alerts are attempted once per run; a crash between marking an alert and sending can omit it because Telegram has no idempotency key. An API response lost immediately after a provider accepts work can still incur another provider call before its checkpoint is saved.

History and provider checkpoints are retained in PostgreSQL. Monitor database size and apply an explicit retention policy when needed; active job checkpoints and weekly occurrence identities must survive retention. No cloud runtime state is written to local JSON files.

## Local development and checks

`npm start`, `npm run dev`, operator CLI commands and local yt-dlp continue to use the existing single-host execution path. `npm run build:ui` builds only React; `npm run build` creates the full Vercel deployment. `npm run dev:cloud` runs Nitro against a development PostgreSQL database with official YouTube metadata, using local Workflow SDK storage. Never point that development runtime at production provider/state configuration.

```powershell
npm test
npm run test:ui
npm run test:vercel
npm audit
```

Cloud tests use real isolated PostgreSQL through PGlite and mocked external providers. They do not certify deployed Vercel execution or live Gemini/Airtable/Telegram calls. After deployment, verify login/logout across fresh sessions, one explicit generation job, its retry/progress history, an approval storyboard, and a temporary schedule. These live checks consume quota and can write content.

Sources: [Workflow SDK Nitro integration](https://workflow-sdk.dev/docs/getting-started/nitro), [Vercel Express](https://vercel.com/docs/frameworks/backend/express), [Vercel Cron](https://vercel.com/docs/cron-jobs), [YouTube search API](https://developers.google.com/youtube/v3/docs/search/list).

## Supabase connection

Supabase hosts the runtime PostgreSQL database; Airtable still holds content and users. In Supabase Dashboard → Connect, select Transaction pooler and copy the PostgreSQL URI into server-only `DATABASE_URL` or `SUPABASE_POOLER` (DATABASE_URL takes precedence). Fill in the database password privately. Keep TLS enabled using the provider's connection settings; do not disable certificate verification.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` configure the optional lazy Node Data API client in `src/clients/supabase.js`. They do not replace `DATABASE_URL`, and the publishable client has no access to runtime tables. The backend does not use Supabase Auth; existing Airtable accounts remain authoritative.

Run `npm run db:migrate` once DATABASE_URL is configured. Alternatively, execute the full contents of `src/cloud/schema.sql` in Supabase SQL Editor. It creates eight runtime tables and their indexes, enables RLS, and revokes anonymous/authenticated access. No public RLS policies are created. Use the PostgreSQL server connection for runtime operations.

Sources: [Supabase PostgreSQL connection](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api).

Supabase TLS verification uses the bundled public Supabase Root 2021 CA in `src/cloud/supabaseCa.js`; no private key is stored. Certificate and hostname verification remain enabled. Update this public CA if Supabase rotates it.
