# Vercel v4 and localhost version-4: current comparison and merge plan

Checked **2026-10-22** against both current worktrees. This report supersedes the current-state tables in the [2026-10-21 assessment](localhost-vercel-migration-assessment-2026-10-21.md); that report remains historical evidence.

## 1. Conclusion and scope

The common Ideas → Script → manual approval → Storyboard flow exists in both versions. The dashboard, complete storyboard display, selected output formats, creative guidance and production briefs have already been ported to Vercel. Repeating those ports would overwrite useful cloud adaptations.

To provide the same functional flows, selectively port localhost's direct topic/script creation, reference analysis and approved blueprints, then its storyboard plan audit and production-ready export. Reconcile pacing, editorial and storyboard data contracts before those ports. Backport Vercel's JSON parser and partial brief updates to localhost. Preserve different execution adapters: local files/one process versus PostgreSQL/durable Vercel workflows.

This is a comparison and implementation proposal, **not an application merge, database migration or deployment**. No live provider calls were made for this assessment. Phase 5 measured-media/channel analytics remains on hold. A text storyboard plan audit is distinct from that held work.

### Authoritative checkouts

| Role | Folder | Git state inspected |
|---|---|---|
| Vercel source | D:\GitHub\storyboard-automation-project-v4 | main, 348fd9f6b157115820c7a23b012dc8f2e56b91f7; application source clean |
| Localhost source | D:\GitHub\storyboard-automation-project-version-4 | version-4, 40dfba6432400e0f24f6e291f4be01e98524e9ca **plus uncommitted changes** |
| Chat's default workspace | D:\GitHub\storyboard-automation-project-version-3 | Not a comparison target; unchanged |

The local uncommitted changes include editorial/evidence acceptance, mixed-duration repair, JSON failure handling, storyboard cache fidelity and audit recovery. They were included in source inspection and tests; they are not all present in local HEAD. A branch-level cherry-pick would therefore omit important behavior described here. Commit/review those changes separately before using them as a migration source. Generated graphify-out and tool-private folders are excluded.

The scoped inventory contains **212 files: 47 identical, 77 different, 53 localhost-only and 35 Vercel-only**. That is 159 Vercel and 177 localhost files. It includes source, UI, tests, shared code, scripts, current documentation and selected root configuration; excludes dependency/build/runtime/private/history/tool output. Hashes normalize line endings and a leading file BOM. It is not a count of missing features. The [inventory and API appendix](v4-functional-parity-inventory-2026-10-22.md) gives every scoped file and route.

## 2. Functional flow matrix

“Present” means current source plus the relevant mocked verification; it does not attest the currently deployed revision or live provider reliability.

| Operator flow | Vercel v4 | Localhost version-4 | Parity work |
|---|---|---|---|
| Register/login/logout, project ownership | Present; durable cloud sessions | Present; process-local sessions | Keep adapters; preserve same authorization |
| Create/list/pause projects and show statistics | Present | Present | No wholesale dashboard port |
| Five tabs: Ideas, Scripts, Storyboards, Settings, Activity | Present | Present | Creation is embedded in local Ideas, not a sixth tab |
| Project Research → requested count of Ideas | Present | Present | Keep evidence separation/count validation |
| Generate selected Ideas or a count sequentially | Present | Present | Same shared Script worker; reconcile validation contract |
| Manual full pipeline | Present | Present | Already independent of weekly schedule |
| Weekly scheduling and run progress/retry | Durable workflow/cron | File-backed schedule and in-process poller | Preserve logical semantics, different restart mechanisms |
| Explicit “recover drafts” dashboard action | Present; recovery-runs API | No dedicated action/API; eligible Draft/blank Ideas can use existing generation | Add cloud action to local if identical operator navigation is required |
| Manual Script approval | Present | Present | Keep human boundary and project checks |
| Completed storyboards separate from approval list | Present | Present | Already ported |
| Three storyboard formats, cards/copy/draft JSON and HTML | Present | Present, with audit controls | Reconcile aliases/timelines rather than replace reader |
| Any of seven nonempty output format combinations | Present | Present | Already ported; freeze selection per video |
| Four versioned creative guidance packs | Present | Present | Preserve existing versions; local adds source-adaptation for supplied scripts |
| Language, duration target, character/style descriptions | Present | Present | Already ported; descriptions are not image approval |
| Immutable per-item brief across retries/default changes | Present; database | Present; JSON file, also creation snapshots | Extend cloud snapshot to creation fields |
| Partial brief default update | Merges omitted fields safely | Full replacement can reset omitted values | Backport cloud patch semantics |
| Enter a topic directly or supply an existing script | Absent | Present via CreationWorkspace | Port local creation flow to cloud adapters |
| Analyze transcript or PNG/JPEG into a reusable blueprint | Absent | Present | Port contract, agent, approved versioning and durable job |
| Approve/archive blueprint, freeze approved version, derive variant | Absent | Present | Port explicit review and request identity |
| “What If” creation profile | Absent | Present; narrated profile, normally Structure 1 | Port with direct creation, preserve evidence rules |
| Automatic/explicit storyboard plan audit and audit-only retry | Absent | Present | Port local audit lifecycle using cloud persistence/workflows |
| Reviewed production-ready export, stale-audit blocking | Absent; draft exports only | Present | Port server gate and matching UI together |
| Rendered-media timing/quality or channel performance analytics | Not implemented/held | Plan auditor does not supply these | Outside parity batch; retain hold |

## 3. Architecture and data ownership

| Concern | Vercel | Localhost | Migration boundary |
|---|---|---|---|
| HTTP/UI | React + Express behind Nitro/Vercel | React + Express process | Reuse UI and business handlers; retain entry/build configuration |
| Content/accounts | Airtable Projects, Ideas, Scripts, Storyboard, Users | Same application model in Airtable | No move of content to PostgreSQL |
| Sessions/runs/schedules/coordination | PostgreSQL cloud stores, leases, shared rate/cooldown coordination | JSON run/schedule state, memory sessions/queues, filesystem locks | Never replace cloud stores with local defaults |
| Production briefs | app_project_briefs + app_item_briefs | Local brief JSON store | Tables already exist; extend contracts, do not re-create them |
| Creation jobs/blueprints/audits | Not implemented | Local durable JSON stores with process queue/recovery | New additive cloud persistence/workflow integration required |
| Trend metadata | Official YouTube Data API in cloud; optional operator yt-dlp | Local yt-dlp binary | Preserve separate providers and common observation contract |
| Long work/retry | Workflow steps, checkpoints, durable DEFERRED sleep, cron reconciliation | Queue/poller, file locks and restart recovery | Cloud jobs must resume rather than fail deferred work |
| Dependencies/build | pg, Supabase SDK, Nitro, Workflow and Vercel build checks | Vite build plus existing Node/React stack | Do not copy package.json or deployment files wholesale |

Both preserve one-concept-at-a-time generation, deterministic idea-backed video IDs and shared Script/Storyboard workers. Both write Ideas/Scripts Projects as the scalar project key. Storyboard transform writes text script_id, linked Scripts/Projects arrays and text project_id. These mappings are not a reason to convert Airtable linked fields into text fields.

Cloud provider responses/history/metadata are checkpointed, and locks can be injected. Local creation/audit store calls are synchronous and workers use process queues; local storyboardWorker hardcodes withFileLock. A direct copy would bypass cloud leases/checkpoints or mark DEFERRED as failed. Adapt store calls to await, use existing cloud execution fencing, and queue persisted job IDs rather than large/private inputs.

Never run local and cloud schedulers concurrently against the same production Airtable records: their coordination systems differ. Same Airtable data does not imply shared locks.

## 4. Validation differences that affect real output

### Script pacing and repair

The deterministic timing helper is identical: **150–180 WPM after configured pauses**. For a 3-second scene with 100ms of pauses, the integer range is eight words. Different generated prompts or durations still produce different outcomes.

Vercel 348fd9f preserves the original first-scene duration uniformly and now sends authoritative repair budgets instead of inheriting a rejected review's stretched timing. Localhost preserves each original scene's duration through source_scene_number and ordered source associations, allowing mixed durations and split scenes. Local's prompt currently calculates displayed timing from the candidate, then appends original durations/associations; Vercel's repair-budget fix should be adapted to the source-duration map.

Local's second logical validation call can use exact word slots for timing-only corrections. It now requires fresh scene reviews for **every final scene** and a fresh overall editorial review. The older concern that compact repair omits factual review is outdated. Its nested format is embedded in a JSON-mode prompt; the validator no longer sends that format as provider responseSchema because of the investigated HTTP 400 path. Other local agents may still use responseSchema.

Do not replace the cloud validator wholesale. Preserve the two-call ceiling, final voiceover reconstruction, identity, source order, independent editorial checks and no-write-on-failure behavior. Add mixed-duration and both correction-path fixtures before enabling cloud mixed-duration generation.

### Editorial and evidence

Both versions now distinguish provider observations from unverified Research hypotheses and persist versioned Idea evidence in strategy_notes. Both require supplied factual URL/excerpt support, complete final scene reviews and bounded recent-content comparisons. Search titles, model knowledge and plausible hedges do not independently verify substantive claims. Neither automatically retrieves and verifies articles.

Local adds first-scene hook identification, source_scene_number, language-aware uncertainty verdicts bound to final-narration quotes, and clearer missing/unexpected/duplicate recent-record diagnostics. Cloud still uses English lexical uncertainty checks, which can conflict with a non-English production brief. Local also validates positive integer Idea counts at the agent boundary.

Preserve these local improvements when merging, but reconcile review schemas/prompts/tests together. Quotation normalization differs: local retains punctuation/numbers while normalizing text/spacing; cloud's spoken-word comparison is more permissive. Choose and test a common contract rather than silently weakening source matching.

Direct local script creation currently constructs a concept from title/content without an explicit factual_sources input contract. A fact-heavy supplied script can therefore fail the stronger gate. Before porting, provide an explicit bounded source/excerpt path or clearly surface the missing-support failure; a blueprint or image observation is not factual evidence.

### JSON failure handling

Vercel's published parser first parses complete JSON, then removes a complete outer Markdown wrapper. Localhost still searches fences before parsing and logs the full response in src/utils/json.js. An offline check reproduced: valid JSON containing literal Markdown fences is accepted in Vercel and rejected locally.

Backport the parser fix/tests and remove that full-response debug echo. Local's separate Gemini changes are useful in the opposite direction: safe GEMINI_INVALID_JSON metadata with model/finish reason and bounded validation retry. In cloud, retain checkpoint semantics and reject malformed results before checkpoint reuse. Do not persist or log raw model bodies merely to improve error messages.

### Storyboard compatibility

The new-generation contracts are **not interchangeable**:

| Offline fixture | Cloud generation gate | Local generation gate | Local saved-cache gate |
|---|---|---|---|
| Three formats using timestamp/time_range clock ranges and frame IDs | Accepted | Rejected | Accepted |
| Same plan using numeric start_seconds/end_seconds and scene_number | Rejected | Accepted | Not needed to establish generation mismatch |

The check used the same approved two-scene Script, narration and 6-second total across all three formats. This proves a concrete format mismatch, not general compatibility of every legacy record. It used current exported gates, not a model call.

Local's current cache gate already normalizes compatible clock/frame/image aliases and separate legacy JSON fields, rejects conflicting aliases and checks against the approved Script. That partially resolves the old assessment's cache blocker. It does not mean local fresh generation accepts the cloud contract. Local normalized clock times require ranges; cloud also accepts point timestamps for frames. Tolerances and narration comparison differ.

Use a pure read/validation normalization boundary for both representations, preserving the raw persisted package and rejecting contradictions. Validate every populated/selected format, source membership/order, narration, total runtime and panels. Never treat an empty or promptless result as completed. Do not bulk revalidate already completed Scripts or rewrite their legacy packages. Keep any regeneration replacement gated until the new package passes.

## 5. Localhost → Vercel merge candidates

| Priority | Candidate and source | Necessary adaptation and acceptance |
|---|---|---|
| 1 | Mixed-duration/source-associated repair; agents/scriptValidation, utils/editorialReview | Keep cloud authoritative budgets and checkpoint/lease injection. Test splitting, silent beats, multilingual uncertainty and fresh complete reviews in both correction paths |
| 1 | Storyboard cache/generation normalization; utils/storyboardValidation, client/src/storyboard | Accept both verified representations without contradictory aliases; retain source-fidelity and selected-only persistence |
| 1 | Safe JSON error metadata and bounded correction retry; clients/gemini, Script worker | Keep published cloud parser, durable cooldown/checkpoints and two logical review calls; safe stage errors without body logging |
| 2 | Direct topic/script creation + approved blueprints; creation/*, agents/referenceAnalysis, CreationWorkspace | Cloud store/job workflow, awaited handlers, owner authorization, stable request identity, frozen approved blueprint/brief; use existing Script worker |
| 2 | What If and source-adaptation@1 guidance; briefs and creativeGuidance | Extend immutable snapshot contract; keep old pack text/IDs available on replay; no extra reviewer loop |
| 3 | Plan auditor; agents/storyboardAudit, audits/*, StoryboardAudit | Database-backed enrollment/intent/revisions, cloud durable dispatch/reconciliation, independent retries and server export gate |
| 3 | Audit UI pointers and production export | Port with backend readiness checks; retain draft exports; stale/missing audit cannot certify production readiness |
| Supporting | Agent count validation, richer comparison diagnostics, focused fixtures/docs | Port narrow changes/tests; do not replace evidence contract or original system messages wholesale |

Local-only agents/features are implemented, but recent local acceptance/recovery changes remain uncommitted. Review and publish that local baseline before selective ports.

### Creation contract to preserve

Local supports topic or supplied-script entries (content up to 20,000 characters), standard/what-if profiles, optional approved blueprint and parent item, and a nonempty unique structure selection. Reference analysis accepts transcript text or a validated PNG/JPEG image, not arbitrary video/audio URLs. Image checks include MIME/signature/base64 and approximately 500KB decoded limit; text and result sizes are bounded. A still image cannot support claims about motion, speech or measured retention.

Analysis produces a draft blueprint. Human approval records reviewer/reason and freezes the version used by later jobs. Repeated request UUID with different input returns 409; retry retains original input/snapshot; a new variant gets a new identity. The direct-entry worker still converges on processIdeaScript with deterministic identity, then ordinary manual Script approval. Preserve this complete chain, not just the input form.

### Plan audit contract to preserve

The local auditor is narrated-plan@2 and evaluates a structured production plan. Its dimensions cover continuity, prompt alignment, hook, progression, payoff and brand; media evidence has zero weight. Scores are editorial assessments, not measured audience performance.

Enrollment, pending intent and immutable report revisions bind the current package, brief and rubric fingerprint. Automatic recovery persists intent before lifecycle completion, and audit failure retains the saved storyboard. Audits retry independently. Changed inputs invalidate readiness and old acknowledgements. Review needs a reason; acknowledgement cannot override a blocking failure. Size limits reject oversized input/report instead of silently truncating evidence.

Production-ready export must check current server readiness even if a browser previously showed a passing audit. Port fingerprinting, recovery and export authorization together.

## 6. Vercel → localhost merge candidates

| Priority | Candidate | Why / preservation boundary |
|---|---|---|
| 1 | JSON-before-fence parser and regression fixtures | Reproduced valid-JSON rejection locally; remove full-response echo, retain safe local error metadata |
| 1 | Partial brief default merges and frozen reference-asset restoration | Older/selection-only clients must not clear language/description defaults; frozen assets must survive later Project changes |
| 1 | Original-duration repair-budget fix | Adapt to local per-source durations; retain mixed scenes and compact final review |
| 2 | Explicit recover-drafts action/API | Gives identical operator workflow; reuse local shared worker/queue, scope to owned project |
| 2 | Dual storyboard representation support and selected-only assertions | Preserve local numeric generation and audit normalization; add clock/point fixtures, not a wholesale cloud worker replacement |
| Optional | Official YouTube API as selectable local metadata provider | Useful if yt-dlp unavailable; not required for equivalent user flow, adds key/quota configuration |
| Documentation/tests | Cloud parser/partial-update/output-selection cases | Adapt mocks to local stores rather than import deployment infrastructure |

Do **not** backport mandatory Supabase/PostgreSQL, Workflow/Nitro build, cron endpoint, cloud sessions or distributed leases into the local-only application. Local restart/persistence proof remains relevant; a cloud-shaped process is not the requested local product.

## 7. APIs and complete parity boundaries

Both have account login/register/me/logout, project management, briefs, Ideas/Scripts/Storyboards, approval, manual pipeline/Idea/Script starts, activity/retry and schedules.

Local adds ten endpoints: creation listing, blueprint create/approve/archive, creation-job start/retry, storyboard-audit read/start/review and production export. Cloud adds explicit recovery-runs. Cloud also wraps /api/cron outside Express with secret authorization. The appendix lists exact methods/paths, source files and current line numbers; shared login/register are generated from the auth action loop.

Preserve session/project checks and active-project/capacity checks for all new mutations. Audit/script IDs must resolve within the owning project. Creation payloads/reference images should not appear in public job listings, workflow arguments or logs. The local image bound should be verified against the actual Vercel body limit before enabling the port; do not silently raise it.

## 8. Proposed batches, data preservation and rollback

1. **Common correctness contracts:** local parser/brief patch; safe parse failure metadata; source-associated timing and multilingual reviews; dual-format storyboard read/validation fixtures. Leave store/entrypoint adapters intact.
2. **Creation and blueprints to cloud:** additive cloud tables for private job input, job state and versioned blueprint/review state; durable dispatch/recovery; extend existing brief snapshots with entry/profile/approved blueprint. Port UI after backend checks. Keep existing Idea entry flow.
3. **Plan auditor and production export to cloud:** additive audit state/enrollment/report revisions and dispatch/reconciliation; preserve intent-before-completion and independent audit retries; then UI/export gating.
4. **Operator parity and acceptance:** local recover action; matching route/UI coverage; execute the controlled live proof only when requested with its write/quota scope clear.

These are proposed batches, not permission to implement or deploy. New table names/schema should follow existing cloud conventions once designed; brief tables already exist. Keep pending/running job IDs, ownership, frozen snapshots, blueprint versions, audit fingerprints and retry metadata stable. Do not migrate sessions or reschedule historical runs accidentally.

Back up relevant app state and identify owners before any import. If importing local state into cloud, stop its server/scheduler and use idempotent IDs/transactions plus record/count verification; do not run two coordination systems against the same production data. Copy neither .env nor generated files.

Rollback should disable new entry/audit dispatch first and deploy the preceding compatible application. Use additive schema and keep completed content/snapshots/history intact; do not drop new tables or rewrite existing Airtable records. Readers must tolerate older snapshots lacking creation/audit fields. Preserve pending work for a later compatible replay instead of force-marking success. Each batch needs an explicit recovery test, not only a happy path.

## 9. Verification and limits

| Evidence | Result / scope |
|---|---|
| Vercel backend suite | 210/210 passed; providers mocked |
| Localhost backend suite | 254/254 passed; includes current uncommitted acceptance/recovery changes |
| Vercel browser suite | 13/13 passed, build + mocked HTTP/workflow tests |
| Localhost browser suite | 18/18 passed; build + mocked creation/audit/dashboard flows |
| Vercel build/routing gate | Passed: static routing, API handler, workflow queue trigger and missing-database behavior |
| Offline cross-contract checks | Clock/numeric generation mismatch and local clock-cache acceptance reproduced; literal Markdown fence parser difference, partial brief merge and frozen asset differences reproduced |
| Graph leads | Both KOS graphs reported current; source verified independently |
| Inventory recheck before drafting | All 212 scoped file fingerprints still matched captured source |

Backend suites include worker/idempotency, ownership, timing, state/recovery and storyboard contracts. Browser suites cover the operator flows in their respective checkouts; they are not interchangeable and do not prove provider output quality.

Parity acceptance after implementation requires the same operator actions in both versions: project/brief → selected/count or direct input → reviewed Script → manual approval → selected storyboard → audit/review/export, with fixed IDs, frozen defaults/blueprint, failed-step-only retry and restart/replay recovery. Add cross-representation fixtures for all seven selections, mixed/silent durations, fractional ranges, conflicting aliases and invalid caches. Reject unsupported claims, missing reviews, changed identity/order and stale export certification in both.

No current production deployment SHA was attested here. Earlier live login/brief persistence and isolated Research→Idea success are historical evidence only. A fresh complete live Script→approved storyboard with frozen brief remains unverified; model availability, quota, deployed environment overrides and actual rendered speech timing were not tested. An isolated Idea fallback success is not a full-pipeline pass.

The requested comparison and two-way merge plan are complete when this report, file/API appendix and test results agree with both inspected worktrees. Functional parity itself remains proposed work, not a claim made by this assessment.


## 10. Completion audit of the comparison request

| Requested deliverable | Evidence in this report |
|---|---|
| Compare the current Vercel v4 and localhost version-4 | Exact roots/revisions and dirty-state caveat; current flow, architecture and validation tables; full scoped file/API appendix |
| Identify what can merge into Vercel v4 | Section 5 names local features, callers/contracts, storage/workflow adaptations and acceptance boundaries |
| Identify what can merge back into localhost | Section 6 lists concrete cloud fixes and exclusions, supported by offline reproductions |
| Explain how to reach the same functional flows | Common/missing flow matrix, four implementation batches, ownership/retry/snapshot preservation, rollback and parity acceptance criteria |
| Verify the assessment against current state | Both backend/browser suites, Vercel build gates, offline contract checks and final fingerprint recheck; only the intentional historical-report pointer changed among originally inventoried files |

Application changes and live production verification remain outside this completed comparison deliverable. Reports remain uncommitted for review.

Next planning artifact: [detailed Vercel phases V0–V7](vercel-phased-implementation-plan-2026-10-23.md), dated 2026-10-23. It defines implementation and verification gates; no phase has been executed by that document.
