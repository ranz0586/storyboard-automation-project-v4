# Vercel implementation plan: selective localhost feature ports

**Date:** 2026-10-23, Asia/Singapore
**Target:** D:\GitHub\storyboard-automation-project-v4
**Source reference:** D:\GitHub\storyboard-automation-project-version-4
**Status:** V0 completed; V1–V2 implemented locally on 2026-10-24, final verification recorded in the implementation note. V3–V5 implementation and final verification are recorded in [the V3–V5 note](vercel-v3-v5-implementation-2026-10-24.md); V6–V7 remain planned. Deployment/live verification remains separate. See [V0 baseline evidence](vercel-v0-baseline-2026-10-24.md).

Based on the [current comparison](v4-functional-parity-comparison-2026-10-22.md) and [file/API inventory](v4-functional-parity-inventory-2026-10-22.md). Vercel main remains 348fd9f. Rechecking the source on 2026-10-23 found localhost now at **9b85070** (fix: strengthen local validation and preserve production briefs), with no tracked changes pending. That commit incorporates the formerly uncommitted work and local parser/partial-brief/frozen-reference/original-budget fixes. The October 22 comparison is historical; use the newer committed source for Vercel ports. The separate localhost-only plan and its completed merge phases do not implement or authorize Vercel changes.

## Intended result

Keep the existing Idea-based and weekly flows, and add complete Vercel paths for:

1. Topic or supplied script → validated Draft Script → human approval → selected storyboard.
2. Transcript or PNG/JPEG → draft blueprint → human blueprint approval → new Script with the frozen approved blueprint.
3. Storyboard → production-plan audit → findings/review → server-authorized production export.

Retries reuse the original inputs, brief, approved blueprint and identities. Worker interruption or lost dispatch must not require repeating successful provider calls or creating duplicate Airtable content.

Airtable continues to own content and accounts. PostgreSQL/Supabase owns server-side app coordination and snapshots. Gemini remains the runtime provider. Vercel retains Nitro, Workflows, database leases/cooldowns/checkpoints and official YouTube metadata. The local yt-dlp binary is not moved into serverless execution.

These **V0–V7** labels are specific to this migration. **V5 below is a text storyboard-audit port; it does not resume the older roadmap's held Phase 5 measured-media/channel analytics.** Rendered media, audio measurement, silent-process families, automated publishing and channel analytics remain outside this plan.

## Already delivered: preserve rather than port again

The five dashboard tabs, separate Storyboards view, full three-format reader, draft JSON/HTML exports, manual full pipeline, weekly schedule, output selection, four guidance packs and production briefs exist in Vercel already. Partial defaults merge and frozen reference-asset restoration are also implemented there.

Keep existing manual approval, project ownership, Draft → Approved → Story Generated lifecycle and idempotent legacy reuse. Never replace cloud app initialization with localhost's JSON stores, synchronous queue, file-lock worker or poller. Do not rewrite the full original agent system messages to achieve a narrow port.

## Sequence and release boundaries

| Phase | Observable outcome | Depends on | New persisted state | Suggested release boundary |
|---|---|---|---|---|
| V0 | Reproducible source and verification baseline | None | None | Documentation/baseline only |
| V1 | Bounded JSON recovery, mixed-duration and multilingual Script review | V0 | No new tables | Reliability release |
| V2 | Both verified storyboard representations safely read/validated | V1 | No new tables | Compatibility release |
| V3 | Topic/supplied-script creation completes on durable cloud jobs | V1, V2 | Creation jobs; extended immutable briefs | Direct-entry release |
| V4 | Reference analysis and approved blueprint reuse | V3 | Versioned blueprints | Blueprint release |
| V5 | Durable independent storyboard audit lifecycle | V2; validate all V3/V4 inputs before completion | Audit enrollment + report revisions | Backend groundwork paired with V6 for operator release |
| V6 | Findings, review and readiness-gated production export | V5 | Review/acknowledgement on audit records | Audit/export release |
| V7 | End-to-end deployed proof and operational handoff | V1–V6 | Evidence only | Final parity acceptance |

Implement in this order for the simplest review path. V5's data/worker work can be designed after V2, but its acceptance must cover creation/blueprint snapshots added by V3/V4. Do not expose an unfinished audit/export promise in the UI.

Each phase ends at its exit criteria. A phase being planned does not mean it is deployed or live-verified.

## V0 — establish the source and release baseline

### Work

1. Inspect both Git worktrees and nested instructions. Preserve existing changes, generated folders and credentials. Record source revisions plus hashes of the local files selected for porting; local HEAD alone is insufficient.
2. Review the editorial, correction, cache-fidelity and audit-recovery changes now committed in local 9b85070 as the source baseline. If local changes again, record any additional diff/hash explicitly; do not assume the older comparison or a branch name identifies the current source.
3. Record the actual deployed revision when deployment access is available. Do not infer deployment from origin/main, a successful login or a Vercel URL.
4. Re-run the relevant baseline gates before implementation if source/dependencies changed: npm test, npm run test:ui, npm run test:vercel. The 2026-10-22 results are historical: 210 backend and 13 browser checks passed in Vercel; 254/18 in localhost.
5. Identify active/queued cloud runs and enabled production schedules before rollout. Do not start a configured local server or run pipeline CLI commands as a harmless smoke test.
6. Define a controlled test project/account and record whether each later live test may write Airtable content, persist app state, spend provider quota and send Telegram. Keep secrets in the configured environment.
7. Capture rollback revision and relevant server-side state backup procedure before the first schema expansion. Do not import local runs/schedules as part of a feature port.

### Deliverables / files

Baseline checklist, chosen source manifest and release evidence in repository documentation/private evidence as appropriate. Existing seams: src/vercel.js, src/cloud/context.js, src/cloud/controllers.js, src/cloud/workflows.js, src/cloud/schema.sql and shared workers.

### Exit criteria

- Exact target/source identified; no unrelated source changes staged.
- All baseline failures classified; no claimed live proof from mocks.
- Known deployed revision or explicitly recorded deployment gap.
- Rollback target and production ownership boundary recorded.

**Data/rollback:** No database or Airtable writes required. Stop after the baseline; no implementation/deployment implied.

**V0 execution checkpoint — 2026-10-24:** [Completed baseline](vercel-v0-baseline-2026-10-24.md): cloud source 348fd9f, local 9b85070 plus captured uncommitted changes; 210 backend/13 browser and Vercel gates passed after classifying one timing-sensitive initial test failure. Production alias/database binding, live test identity and pre-expansion backup restore remain explicit release gaps. No V1 implementation or deployment.

## V1 — reliable Script validation and safe JSON failures

### Operator result

Valid JSON is preserved, malformed provider output fails with useful safe metadata, and a valid mixed-duration or non-English Script can pass the same strict factual/editorial acceptance without repeated unbounded repairs.

### Implementation tasks

1. Preserve the published raw-JSON-before-Markdown parser and its literal-fence fixtures. Do not reintroduce the former localhost full-response debug echo or fence-first parser; both parser correction and debug removal are now committed locally.
2. Adapt local GEMINI_INVALID_JSON errors into src/clients/gemini.js: safe model/finish reason/position metadata, no raw response text. Preserve primary/fallback handling, transient backoff and database cooldowns.
3. Within the existing validation loop, allow the remaining logical correction opportunity for invalid JSON. Two logical validation calls remain the ceiling; document separately that a logical call can contain existing provider fallback/transient attempts.
4. Review the specific owner-authorized local Script system-message diff before adopting mixed durations: the current cloud Script system explicitly requires one uniform duration. Record explicit acceptance of this behavior change in the V1 implementation scope and reconcile that exact rule with the user prompt/validator; do not leave contradictory instructions or rewrite unrelated original system text. Port source_scene_number and original scene-duration associations into Script validation. Preserve original source order across renumbering/splits; split scenes inherit their source duration. Validate both under-length and over-length narration after pauses.
5. Adapt Vercel's authoritative repair budgets to the original source-duration map. Do not calculate the next permitted duration from a rejected model candidate.
6. Port first-scene hook identification and language-aware uncertainty with a quote bound to final narration. Preserve rejection of unsupported substantive/sensitive claims, and complete recent-content comparison IDs.
7. If porting compact timing correction, use it only for timing-only failures. Require exact single-word slots, matching visuals, fresh reviews for every final scene and a fresh overall editorial review. Keep nested correction format in the JSON prompt rather than enabling the previously problematic provider schema path.
8. Rebuild final voiceover from accepted scene narration; preserve video identity, frozen brief and What If fields when later introduced. No Script persistence or Idea completion after failed acceptance.
9. Keep successful model checkpoints, request hashes, locks, execution slots and lease guards intact. Do not checkpoint a parse failure as a successful effect.
10. Validate Idea count at the shared agent boundary for non-HTTP callers as well.

### Affected source

src/clients/gemini.js; src/agents/scriptValidation/index.js, prompt.js and the owner-created validation system message only where necessary; src/utils/editorialReview.js; src/agents/script/prompt.js and the specifically authorized duration rule in system.js; src/agents/idea/index.js; src/scriptWorker.js for safe stage errors. Existing cloud context/workflow adapters must continue to inject their clients and locks.

### Required proof

- Literal fences inside JSON values; complete outer fences; genuinely malformed JSON; safe error text without body leakage.
- Primary/fallback failure, cooldown deferral and successful replay checkpoint.
- Original 2/3/5-second scenes, mixed durations, pause changes, under/over word budgets, silent beats, splits and reordered/missing source associations.
- Non-English and code-switched uncertainty; missing/false quotes; supported vs unsupported factual claims.
- Timing-only compact repair includes all final reviews; semantic failures use full correction; no third logical call.
- Unresolved errors produce no Script save and no generated-Idea status.
- Existing uniform-duration, legacy reuse and manual/scheduled/recovery fixtures remain green.

### Exit / rollback

All focused regressions, backend suite, browser smoke and Vercel build pass. No schema required. Keep pending jobs from mixing incompatible prompt/review contracts: drain affected old runs before the release, or demonstrate old/new replay compatibility with a pinned contract before overlap. Do not assume an old successful checkpoint can be safely regenerated under a changed prompt.

Rollback the application revision while retaining content/snapshots; do not rewrite accepted legacy Scripts. A failed live model attempt does not justify relaxing acceptance.

## V2 — storyboard compatibility and source fidelity

### Operator result

Approved Scripts convert and reopen correctly whether a compatible plan uses clock ranges/frame IDs or numeric scene/start/end fields. Existing completed packages remain readable.

### Implementation tasks

1. Define one pure internal timeline shape: ordered source scene number, start/end seconds, narration and panel membership. Use a small shared normalization helper only where server validation, reader and later auditor genuinely need the same interpretation.
2. Accept observed clock/numeric representations at read/validation boundaries. Preserve stored raw output; do not bulk rewrite Airtable packages.
3. Resolve aliases only when unambiguous. Reject conflicting scene IDs, narration, times, prompts or panel references rather than choosing a favorable alias.
4. Define and test point-frame timestamp interpretation separately from a range; it can establish a start but must not invent an unprovable panel/end duration. Align tolerance and text normalization explicitly.
5. Require exact source coverage/order/narration, full runtime, valid source totals/voiceover, usable prompts and all selected formats. New persistence contains only selected formats.
6. Retain worker cache re-read and identity checks under injected database lock. A conflicting/unverifiable cache on an Approved Script may regenerate; replacement must pass before overwriting.
7. Preserve compatible legacy snapshot and separate-JSON-column reads. Do not enroll already completed Scripts into new validation or regenerate them en masse.
8. Keep generation prompt output close to existing provider contract. No new storyboard repair loop, parallel content generator or broad schema tightening.

### Affected source

shared/storyboardStructures.js; proposed shared/storyboardTimeline.js if needed by multiple consumers; src/utils/storyboardValidation.js; src/agents/storyboard/prompt.js; src/storyboardWorker.js; client/src/storyboard.js and reader fixtures. Preserve original Storyboard system message and cloud injection.

### Required proof / exit

Cross-feed clock and numeric fixtures for every one of the seven selections; test Structure 2-only, fractional ranges, silent tails, duplicate/reordered/missing scenes, mismatched narration, malformed legacy columns and alias contradictions. Invalid source fails before Gemini. Invalid new output cannot save/complete; invalid cached replacement does not overwrite good persisted data.

All old reader exports and worker idempotency/recovery tests pass. No new table or live content rewrite. Rollback reverts the new adapter; keep original representations and old snapshots intact. Before a later rollback to a clock-only release, verify it can read any newly persisted numeric package or keep cloud writes in its existing clock form.

## V3 — direct topic and supplied-script creation

### Operator result

In Ideas, the operator selects Topic or Existing script, submits one item, sees durable progress/retry, and receives a validated Draft Script. Ordinary manual approval and storyboard conversion follow.

### Backend/state work

1. Port EntrySchema's bounded title/content, standard/what-if profile, optional explicit format selection and parent/new-variant semantics. Leave existing Ideas generation available.
2. Add an explicit bounded factual_sources contract for supported supplied claims. Proposed limits to confirm at implementation: at most eight URL/excerpt rows, each excerpt at most 3,000 characters, plus a UTF-8 request-byte bound. Keep a missing-support error actionable; do not invent sources or automatically treat supplied text as verified.
3. Add app_creation_jobs (proposed name): UUID ID, owning Airtable Project record ID and project key, request UUID, operation type, original input hash/private payload, frozen snapshot, status/timestamps, workflow owner/attempt/result/safe error. Unique (project_id, request_id).
4. Reuse the existing JSONB/state and database lease patterns, not a new queue service. Atomically persist input before dispatch; same request/input returns original job, conflicting input returns 409. Compare the original input before applying changed defaults.
5. Extend existing app_item_briefs snapshot construction/freeze to include entry/profile and versioned source-adaptation guidance when applicable. First writer wins; retries never refresh Project references/defaults. Older snapshots without creation remain valid.
6. Add a durable creation Workflow dispatched with job ID only. Step loads the private input, checks ownership/active project and uses withSlot, withLock and checkpointed clients. Use stable job/stage/input identities so a successful stage survives replay.
7. Converge on processIdeaScript, not another generator. Use the local direct-entry deterministic identity convention (entry_<job UUID> → idea_entry_<job UUID>) without creating/updating a fictitious Airtable Idea record.
8. A deferred key/slot sleeps durably without failing the job. Duplicate dispatch must have one active owner. Reconcile queued/lost dispatch and interrupt stale owner state safely.
9. Mirror safe Activity metadata without leaking reference/source payloads. Keep result links separate from full private input; paginate job listings rather than grow an unbounded response.
10. Add authenticated project-scoped creation listing/start/retry routes. All asynchronous store calls are awaited; retain active-project checks, throttling/capacity and original-ID ownership.
11. Port the direct-entry portion of CreationWorkspace into the existing Ideas tab; preserve input on error/tab changes and clearly show result/failed-stage retry. Blueprint controls arrive in V4.
12. Apply source-adaptation@1 and What If visual initial/motion/final-state validation through existing prompts/shared acceptance, without extra agent round trips.

### Proposed API and files

GET /api/projects/:id/creation; POST /api/projects/:id/creation-jobs; POST /api/projects/:id/creation-jobs/:jobId/retry.

Port src/creation/contract.js and routes.js with cloud adapters; implement a cloud creation store/workflow integration in src/cloud/ using existing conventions. Extend src/cloud/context.js, controllers.js, workflows.js, schema.sql, src/vercel.js injection, briefs/contract.js, cloud/briefStore.js, scriptWorker.js, creativeGuidance/index.js and client/src/CreationWorkspace.jsx/App.jsx. Keep local-only file implementations out of cloud initialization.

### Database/security and rollout

Use additive idempotent migration and indexes for project/job lookup and recoverable status. Add new tables to the existing server-only RLS/revoke block: no browser Supabase Data API grants. Provider work stays outside transactions.

Deploy schema first; verify old code still works. Deploy compatible handlers/workers before exposing the UI. Pause new creation dispatch for rollback, keep pending rows and resume them only with compatible code. Do not drop tables, mark unfinished jobs successful or delete produced Airtable Scripts.

### Required proof / exit

Topic, supplied script and What If all use the shared worker and persist a Draft with correct owner/snapshot. Cover missing sources, unsupported claims, duplicate request vs 409 conflict, concurrent claims, mid-provider interruption, post-save/pre-finish crash, changed defaults on retry, project pause/identity change and cross-project requests. Restart/replay resumes without duplicate content; no mutable blueprint state is needed yet.

Mocked browser flow reaches Draft → human approval → selected storyboard and displays retry/result correctly. Backend and Vercel build gates pass. V3 can ship without reference analysis.


## V4 — reference analysis and approved blueprints

### Operator result

The operator supplies a transcript or PNG/JPEG, receives observations and a draft reusable blueprint, approves a specific version, then uses that frozen version for a new Script or variant.

### Implementation tasks

1. Extend creation jobs with ANALYZE, preserving job identity, private payload, durable dispatch and stage checkpoints from V3.
2. Port ReferenceSchema and AnalysisSchema, factual limitations and quote validation. Preserve text ≤20,000 characters, PNG/JPEG signature/MIME/base64 checks, decoded image ≤512,000 bytes, encoded field ≤700,000 characters, and analysis output ≤40,000 JSON bytes.
3. Resolve request parsing before enabling image UI. src/app.js currently calls express.json() without a custom limit. Use an explicitly bounded parser for this authenticated endpoint in the correct middleware order; a later route parser cannot fix a body already rejected by the global parser. Keep default limits on unrelated endpoints. Verify current Vercel request limits during implementation.
4. Keep one bounded image in the job's private server-side JSON payload for this version, matching the local scope. Do not introduce an asset service unless measured size/retention needs require it. Strip image bytes/source bodies from public metadata and workflow arguments; never log them.
5. Extend GeminiClient media handling for validated inlineData. Preserve cloud provider checkpoints, cooldown/lease behavior and safe parse errors. Do not assume text-only model construction already handles images.
6. Port referenceAnalysis agent definition/prompt/runner. Still images cannot establish motion/audio/duration/retention; transcripts cannot establish rendered appearance or performance. Observed transcript quotes must be present in supplied text.
7. Add app_blueprints (proposed): immutable UUID/version content, family/parent links, owning project, status, observation/provenance metadata, source job ID, approval reviewer/reason/time. Enforce unique family/version and one result per analysis job under concurrency.
8. Keep blueprints DRAFT until explicit approval; reason is 10–2,000 characters and reviewer comes from the authenticated session. New edits create a new version. Archive prevents new selection, not access to already-frozen jobs.
9. Freeze approved blueprint ID/version/content/approval in a new creation job and its item brief. Revalidate approval for a new request; retries return the original snapshot even if the blueprint is later archived.
10. Extend CreationWorkspace with source analysis, version preview, approve/archive and optional approved-blueprint selection. Show limitations without calling a blueprint factual proof.
11. New variants get new job/video identity and tracked parent; they do not overwrite an approved Script.

### API / affected source

Extend the V3 endpoints and add POST /api/projects/:id/blueprints, POST /api/projects/:id/blueprints/:blueprintId/approve and POST /api/projects/:id/blueprints/:blueprintId/archive.

Port src/agents/referenceAnalysis/* and reference/blueprint contracts; extend the cloud creation store/workflow, schema security list, briefs/guidance, Gemini media support and CreationWorkspace. No arbitrary video/audio URL retrieval, new external media service or YouTube transcript feature.

### Required proof / exit

- Reject wrong MIME/signature/base64, oversized decoded/encoded bodies, unsupported kind and cross-project IDs.
- Prove a request at the accepted image bound reaches route validation; prove excessive requests fail before provider work.
- Concurrent analysis replay produces one blueprint. Saved successful response is reused after lost dispatch/result update.
- Draft/archive cannot be newly selected; approval has correct reviewer/reason and immutable version.
- Change/archive blueprint after job submission; retry still uses original frozen content.
- Model-invented transcript quote or unsupported observation fails analysis acceptance.
- Complete mocked transcript/image → blueprint approval → Script → human approval → storyboard workflows pass.

**Rollback:** stop new analysis dispatch/controls; preserve private jobs/blueprint history and frozen copies. Previous direct-entry paths remain usable. Additive schema remains. Do not re-read the current blueprint to repair a historical snapshot.

## V5 — durable storyboard plan audit backend

### Operator result

A newly enrolled storyboard gets a separate production-plan review. Audit failure does not undo storyboard content or require Script/storyboard regeneration. Audit retry is independent.

### Implementation tasks

1. Port narrated-plan@2 contract, deterministic prechecks, canonical package/brief/rubric fingerprint and evidence pointers. Run against the V2 normalized representation.
2. Keep source approval, all selected structures, full timeline/narration, usable prompts and source totals as deterministic conditions. Invalid evidence cannot receive a favorable model override.
3. Preserve input ≤180,000 UTF-8 JSON bytes and report ≤60,000 bytes. Reject excess with a clear size error; no hidden truncation.
4. Add app_audit_enrollments and app_audits (proposed names) as durable state separate from prunable Activity:
   - Enrollment: project record/key, Script ID, video identity, source, generation/completion state and timestamps.
   - Audit revision: UUID, enrollment reference, input fingerprint, package/brief hashes, audit/rubric versions, evidence scope, status, owner/attempt/timestamps, report/verdict/safe error and optional acknowledgement.
   - Index recoverable status, project/Script revisions and fingerprint lookup. Suppress duplicate active/successful attempts; explicit retry after failure creates a preserved new revision, not an overwritten report.
5. Before new enrolled storyboard generation, persist/reset generation enrollment. After a usable storyboard is saved, persist current fingerprint intent before marking Script Story Generated. Retain recovery for crashes between Airtable write, intent creation, Script completion and dispatch.
6. Recognize that PostgreSQL and Airtable cannot share one atomic transaction. Reconcile from persisted enrollment and current content; do not hold a database transaction across Airtable/provider calls.
7. Introduce a durable audit Workflow using current cloud slots, leases/guarded clients/checkpoints and job-ID dispatch. Deferred work sleeps; stopped owners are fenced; successful output/report saves are replay-safe.
8. Port auditRecovery as an awaited cloud reconciler: recreate missing current intent, do not mistake a completed older fingerprint for a current audit, dispatch recoverable work once and retain source identity.
9. Automatic enrollment applies to the new participating generation path. Existing completed packages remain legacy/unaudited until explicit opt-in. Switching off future automatic enrollment must not abandon already-enrolled recovery.
10. Keep all audit checks independent of Storyboard lifecycle completion. A saved usable storyboard may be Story Generated while audit is pending/failed; production readiness is a separate state.
11. Implement project-scoped audit read/start with current state and staleness. Do not show raw model bodies, private content or process-owner internals.
12. Keep rubric dimensions/weights and scope explicit: continuity 25, prompt alignment 25, hook/progression/payoff 15 each, brand 5, media 0. These are editorial plan scores, not measured retention or rendered quality.

### API / affected source

GET and POST /api/projects/:id/scripts/:scriptId/storyboard-audit.

Port src/agents/storyboardAudit/*, src/audits/contract.js, worker/recovery business logic and route contracts. Add cloud audit store/workflow integration and migrations; extend shared storyboardWorker with injected enrollment/intent dependencies while preserving injected withLock. Wire through cloud/context.js, controllers.js, workflows.js and vercel.js. Reuse canonical normalization; do not import the entire local app.

### Required proof / exit

Crash-inject before/after generation, upsert, pending intent, Script status, dispatch, provider response and report completion. Verify saved content survives and current audit eventually resumes. Test duplicate dispatch, expired lease, successful old fingerprint, changed brief/package/rubric, generation with auto-enrollment disabled, partial failure and audit-only retry.

An invalid source/deterministic check cannot pass. Oversized evidence fails without truncation. Cross-project IDs are rejected. No audit retry calls Script or Storyboard generation. Existing weekly/manual content paths and completed legacy reuse remain green.

**Rollout/rollback:** additive schema and awaited store first; backend dispatch next. Do not expose production-ready UI before V6. Rollback pauses new audit enrollment/dispatch while keeping recoverable intent/revisions; content stays intact. A prior app must not serve a production-ready export that ignores the newer certification state.

## V6 — findings, human review and production export

### Operator result

Storyboards show current audit status and findings linked to scenes/panels. The operator can retry audit alone, acknowledge eligible editorial findings with a reason and obtain production-ready export only when current server evidence allows it. Draft export remains available.

### Implementation tasks

1. Port StoryboardAudit UI/CSS and evidence-path navigation into the existing Storyboards reader. Reuse the current layout/components; no dashboard redesign.
2. Distinguish unaudited, pending/running, failed, stale and completed readiness. Never label an unaudited legacy package failed or certified.
3. Add POST /api/projects/:id/scripts/:scriptId/storyboard-audit/review. Only eligible completed editorial NEEDS_REVIEW findings may be acknowledged, with session reviewer and reason 10–2,000 characters.
4. Acknowledgement adds immutable review evidence. It does not change original model verdict, erase deterministic failure, override blocking findings or transfer to another audit/fingerprint.
5. Add GET /api/projects/:id/scripts/:scriptId/production-export. Re-read the owning Script, storyboard, snapshot and audit inputs on every request, then enforce current fingerprint/rubric/readiness server-side. Return 409 for stale/missing/blocked certification; retain the draft export route/UI behavior.
6. Build export from the same loaded/checked package, not a second unchecked browser copy. If concurrent mutation is observed or source identity differs, refuse and refresh; do not claim a cross-service atomic freeze.
7. Keep output escaping, clipboard/print behavior, selected-format completeness and accessible controls. Findings must navigate to real corresponding cards.
8. Surface audit retry and export errors clearly without losing selection or unsaved settings. Paused projects retain reads; new mutations continue active-project checks.

### Affected source

src/audits/routes.js, cloud audit state and readiness logic; client/src/StoryboardAudit.jsx/.css, StoryboardPackage.jsx, App.jsx and existing export helpers. No new agent, paid API or background rendering service.

### Required proof / exit

Browser tests cover fresh successful audit/export, audit failure/retry, editorial acknowledgement, blocked acknowledgement, stale package/default/rubric input, legacy opt-in, unsafe strings and real scene-pointer navigation. HTTP tests bypass browser controls to verify readiness is actually enforced by the server and project ownership holds. A stale open browser tab cannot authorize export.

**Rollback:** hide/disable production-ready export and new review actions before reverting incompatible readiness code. Keep draft exports and saved content. Preserve reports/reviewer history. V5/V6 ship as one operator feature even if code review is split into separate changes.

## V7 — deployed acceptance and handoff

### Verification order

1. Run focused phase tests, then npm test, npm run test:ui and npm run test:vercel on the final source. Record exact commit, command, exit code and scope. Prior counts are a baseline, not a permanent required total.
2. Apply only the additive, reviewed schema changes to the intended environment. Run migration twice to prove idempotency; check indexes/server-only access and old readers before enabling new writes.
3. Deploy the intended revision, attest its identity, and check health/auth/project/brief APIs. Confirm new routes, workflow entry points, cron authentication and no in-process server/scheduler construction.
4. Use bounded live tests whose quota/write/alert effects are explicitly in scope. Default to one item per independently tested path:
   - Existing Idea pipeline → Script.
   - Direct topic or supplied script → Draft.
   - Reference → approved blueprint → new Script.
   - Human-approved Script → selected storyboard → audit → current production export.
   Use verified supported source material or clearly hypothetical content; do not spend repeated calls trying to bypass missing evidence.
5. Use actual human approvals for Script/blueprint boundaries. Do not silently approve every generated artifact as a test convenience.
6. Test one controlled failure/retry and durable wake-up; use mocks for destructive/racy crash windows. Do not kill or interrupt unrelated production runs.
7. Verify fixed video/storyboard IDs and correct Airtable project fields, no duplicate rows, frozen briefs/blueprints and independent audit revisions. Count provider invocations by stage/checkpoint to demonstrate successful calls were not needlessly repeated.
8. Verify manual pipeline, weekly schedules, selected/count generation, existing recover-drafts action and legacy storyboard/draft exports still work. Isolate schedule checks from real due production schedules.
9. Record primary/fallback/model errors as observed outcomes, not a guarantee of provider availability or avoiding quota limits. Stop a live path on a repeatable validation/configuration failure and fix it under the appropriate earlier phase.
10. Update AGENTS.md/CLAUDE.md shared rules and operator docs where behavior changed; refresh KOS graph after code/config edits and separately verify status. Record release revision, migration versions, live proof, skipped checks and rollback state.

### Acceptance matrix

| Invariant | Mocked/unit/HTTP proof | Browser proof | Deployed proof |
|---|---|---|---|
| Existing pipeline remains usable | Shared worker/controller regression | Manual and selected/count generation | One bounded existing path |
| New entry stays owned and frozen | Duplicate/conflict/concurrent claim + changed defaults | Topic/script submit/retry/result | One bounded direct job |
| Blueprints remain reviewed/versioned | Approval/archive/retry snapshot | Analyze → review → use | One analysis-derived job |
| Script quality is independently gated | Timing/source/review/claim negatives | Clear failure and retry | Accepted sample; inspect persisted final reviews |
| Storyboard exactness/selection | Both representations and all seven selections | Cards/draft exports | One selected output inspected |
| Audit is independent/recoverable | Crash windows, stale fingerprint, size/lease failures | Audit retry only | One stored revision and retry where justified |
| Production export is server-gated | Direct API bypass tests | Stale/blocked/export states | Current authorized export |
| Operational compatibility | Replayed workflow + old snapshot/schema tests | Existing navigation preserved | Correct deployment/cron/health and state |

### Final exit

All three requested new paths work in Vercel, existing paths remain intact, migrations/access checks pass, and actual live evidence is explicitly separated from mocks. Any unsupported live path is documented as incomplete; green mocked tests do not close it.

**Rollback:** disable new starts and automatic dispatch, preserve jobs/reports/content, deploy the recorded compatible revision and leave additive tables. Reconcile only with a compatible worker. Do not re-import sessions, duplicate schedules, drop audit data or mass-reset Airtable status.

## State/API contract checklist

### State ownership

| Entity | Owner/system | Mutable boundary |
|---|---|---|
| Account, Project, Idea, Script, Storyboard | Existing Airtable integration | Existing authorized content methods/typecast; unchanged field identities |
| Brief defaults | Existing app_project_briefs | Partial updates only |
| Item brief / entry / approved blueprint copy | Existing app_item_briefs | First writer wins; new revision gets new identity |
| Creation input/result/state | Proposed app_creation_jobs | Immutable input/snapshot; fenced state transitions |
| Blueprint version/approval | Proposed app_blueprints | New version for content edits; recorded approval/archive |
| Audit enrollment/current generation intent | Proposed app_audit_enrollments | Fenced lifecycle and recoverable intent |
| Audit report/review revision | Proposed app_audits | Immutable report/fingerprint; append acknowledgement evidence |
| Provider cooldowns, leases, effects | Existing cloud coordination | Reuse; no secret/provider body serialization into Workflow arguments |

Table names are proposed, not existing schema claims. Confirm final DDL constraints and security block at implementation. Avoid a generic job framework or additional service when the existing cloud seams suffice.

### New endpoint checklist

| Phase | Method and path |
|---|---|
| V3 | GET /api/projects/:id/creation |
| V3 | POST /api/projects/:id/creation-jobs |
| V3 | POST /api/projects/:id/creation-jobs/:jobId/retry |
| V4 | POST /api/projects/:id/blueprints |
| V4 | POST /api/projects/:id/blueprints/:blueprintId/approve |
| V4 | POST /api/projects/:id/blueprints/:blueprintId/archive |
| V5 | GET /api/projects/:id/scripts/:scriptId/storyboard-audit |
| V5 | POST /api/projects/:id/scripts/:scriptId/storyboard-audit |
| V6 | POST /api/projects/:id/scripts/:scriptId/storyboard-audit/review |
| V6 | GET /api/projects/:id/scripts/:scriptId/production-export |

These mirror the local operator capabilities while adapting persistence/execution. Authenticate, authorize the resolved Project and every child identity, enforce body bounds and await stores before acknowledging success.

## Recommended first action and stop condition

Start with **V0 baseline, then V1 reliability**. Do not start UI/blueprint migrations while the shared validation contract remains incompatible. Deploy or run live calls only as part of an explicitly scoped implementation/release request; this document requests no new credentials or infrastructure.

Planning is complete when each phase has source seams, dependencies, bounded tasks, data ownership, concrete verification and rollback. This document leaves actual implementation, migrations, commits/pushes and live calls untouched. No phase completion is implied by the older roadmap's numbering.


## V1–V2 implementation checkpoint — 2026-10-24

See [implementation and requirement-by-requirement evidence](vercel-v1-v2-implementation-2026-10-24.md). Source changes are local/uncommitted; no deployment, schema migration, live provider calls or V3 work. This checkpoint supersedes the older V0 note that V1 had not yet started.
