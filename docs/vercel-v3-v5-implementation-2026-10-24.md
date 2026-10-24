# Vercel V3–V5 implementation — 2026-10-24

Implemented in `D:\GitHub\storyboard-automation-project-v4`, on top of the uncommitted V1–V2 work based on `348fd9f`. The localhost reference checkout remains unchanged. These are migration phases V3–V5, not the older held Phase 5 analytics work.

## Result

- V3: Ideas now offers direct topic/supplied-script entry, optional supplied factual evidence, standard/What If profiles, saved inputs, retry and independent variants. Jobs and original project/brief settings are saved in PostgreSQL before ID-only Workflow dispatch. Shared `processIdeaScript` writes a deterministic `idea_entry_<job UUID>` Draft, with no invented Idea row. Human approval remains required.
- V4: bounded transcripts or PNG/JPEG references produce evidence-limited draft blueprints. Manual edits create immutable family versions. Approval records the session reviewer and reason. Archive prevents new selection; already submitted jobs retain their approved frozen copy. Gemini inline image data reaches the provider through existing checkpoints/cooldowns.
- V5: new cloud storyboard generations enroll before provider work and save an audit intent before Script lifecycle completion. Independent `narrated-plan@2` production-plan audits have immutable revision/fingerprint/report identities, source-linked evidence, separate retries and current/stale read/start APIs. Audit failure never regenerates or deletes content. Recovery handles the Airtable/PostgreSQL boundary and previously enrolled work even when future automatic enrollment is disabled.

The existing Research/Idea path, weekly schedules, manual Script approval, raw saved package exports and local execution adapter remain available. No V6 findings/review/production-export UI or endpoint was added. No new dependencies, local-state import, schema changes in Airtable, paid analytics or asset service.

## Storage and execution

`src/cloud/schema.sql` adds `app_creation_jobs`, `app_blueprints`, `app_audit_enrollments` and `app_audits` with lookup/status/uniqueness indexes. RLS is enabled and PUBLIC/anon/authenticated table access revoked. Supabase contains runtime coordination state; Airtable still holds Projects, Ideas, Scripts and Storyboards. The existing database migration command applies the additive schema idempotently.

Creation request UUIDs are unique within a Project record ID. Identical original input returns the original job before current defaults are applied; changed input returns 409. Project ownership, active state and custom key are checked. Job listing is paginated and excludes source bodies/image bytes and Workflow owner IDs. An owned job-detail endpoint loads Script input for a variant; analysis image bytes are never returned there. Blueprint listing currently shows the newest 10 versions (a documented limit).

Creation and audit use existing shared execution slots, database leases, guarded clients and provider checkpoints. Deferred slots/keys become durable Workflow sleeps. Reconciliation rediscovers queued jobs and fences/reset owners only after a missing or terminal Workflow. Save-only Script/reference retries reuse the prior provider namespace; failed generation or validation gets a new attempt. Provider work stays outside database transactions. Activity contains safe terminal summaries; durable production state is independent of Activity.

New endpoint families:

- `GET /api/projects/:id/creation` (`limit` 1–50, default 20; `offset` 0–10000).
- `GET /api/projects/:id/creation-jobs/:jobId` and `POST /api/projects/:id/creation-jobs`; `POST .../:jobId/retry`.
- `POST /api/projects/:id/blueprints`; `POST .../:blueprintId/approve` or `/archive`.
- `GET`/`POST /api/projects/:id/scripts/:scriptId/storyboard-audit`.

## Trust boundaries and limits

Creation requests use a route-specific 800,000-byte JSON parser after authentication/ownership; unrelated endpoints keep their existing parser limit. Title ≤200 characters, input ≤20,000 characters, factual sources ≤8 URL/excerpt pairs, each excerpt ≤3,000 characters. The UI edits one citation and retains additional saved citations when making a variant. Supplied sources remain subject to validation; absence of support cannot be bypassed by a blueprint.

Reference images require matching PNG/JPEG signature, MIME and valid base64, ≤512,000 decoded bytes and ≤700,000 encoded characters. Analysis output ≤40,000 JSON bytes. These request bounds fit below Vercel's documented [4.5 MB Function request/response limit](https://vercel.com/docs/functions/limitations), checked 2026-10-24. Source bodies/image bytes stay in private server-side job payloads, not Workflow arguments or public job history.

Audit inputs are complete, ≤180,000 UTF-8 JSON bytes; reports ≤60,000 bytes. Excess fails without truncation or provider calls. Approval, selected structures, timeline, exact narration, coverage and usable prompts are deterministic checks. Evidence quotes/pointers/times and rubric identities are validated. Model PASS cannot override invalid source checks. Dimensions: continuity 25, prompt alignment 25, hook/progression/payoff 15 each, brand 5, media 0. This reviews a text plan, not rendered video/audio or measured performance.

`STORYBOARD_AUDIT_AUTO_ENABLED=false` prevents future automatic enrollment; default is enabled in injected cloud execution. Existing completed legacy packages remain unaudited until explicit opt-in. Previously enrolled incomplete generations still recover. Shared local/operator calls without an injected audit store keep their existing behavior.

## Rollout and rollback

No live migration, deployment or provider/content writes were performed for this implementation.

Before rollout, verify Production database/alias binding, take a restorable runtime-state backup, check active work and enabled schedules, and drain incompatible older Workflows. Apply `npm run db:migrate` to the intended database first, then deploy the matching handlers/Workflows/UI together. Do not import local state. Verify bounded live creation/audit behavior separately with authorized test records and quota.

For rollback, pause new creation/audit starts and automatic dispatch, retain all new tables, private inputs, enrollments/revisions and Airtable content, then restore compatible code. Disabling future auto-enrollment alone is not a dispatch pause. Do not drop tables, mass-reset Script status or erase completed reports. Older releases must not claim production certification while ignoring newer audit state. V1–V2 drain and numeric-cache rollback caveats still apply.

## Verification

Final gate results are recorded below after execution. All providers and Airtable in tests are mocked; isolated PGlite validates the SQL and transactions. Browser dispatch uses a test-only executor; emitted Vercel Workflow queue/handler output is checked separately. Hosted delivery, real quotas and production migration remain unverified.

Final checks: 243/243 backend tests passed with test-file concurrency 1; 16/16 browser tests passed; npm run test:vercel passed, followed by retained production Workflow/step emission assertions. Syntax/whitespace checks passed. Desktop 1440px and phone 390px creation screenshots were inspected; no horizontal overflow. The one-time Impeccable detector returned no findings. KOS graph refreshed to 881 nodes at base 348fd9f, then separate status reported current.

Test history: the first full parallel backend rerun hit ENOTEMPTY while an unchanged sharedState two-process test cleaned up a Windows temporary directory (242 passed, 1 failed); the complete sequential suite passed without changing that test. An earlier shared-worker error wrapper changed a legacy expected storage message; it was corrected to preserve the original error and add only a safe persistence classification. New browser tests needed role-based selectors. Existing browser expectations were updated for newly supported creation endpoints and project-scoped Script counts; final full browser suite passes. No product validation or timeout was weakened.

Final logs and source hashes: data/vercel-v345-implementation-evidence-20261024.json (gitignored local evidence). Live migration, hosted queue delivery, real provider quota/content correctness, production alias binding and backup/restore remain rollout checks; no claim of live verification is made.
