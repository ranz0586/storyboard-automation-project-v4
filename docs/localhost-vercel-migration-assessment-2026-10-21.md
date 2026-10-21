Selective migration assessment — localhost version-4 ↔ Vercel v4

Assessment date: **2026-10-21, Asia/Singapore**. **Plan only:** no application source edits, merges, commits, deployment, DB migration or live provider calls. Vercel's proposed Phase 5 (measured audio/media and analytics) remains on hold.


Subsequent implementation: migration batch M1 (dashboard workspace and saved-package reader) was authorized and implemented after this assessment. See [dashboard port](dashboard-port.md). The file inventory and baseline counts below remain the pre-port snapshot; later feature batches and held measured-media/analytics work are not included.

**1. Compared versions and evidence**

| Role | Canonical folder | Branch / HEAD | Current state |
| --- | --- | --- | --- |
| Localhost | D:\GitHub\storyboard-automation-project-version-4 | version-4 / 7261133 | Extensive tracked edits and untracked feature files: briefs, guidance, tabs, auditor and alternate inputs. |
| Vercel | D:\GitHub\storyboard-automation-project-v4 | main / 7461071 | Includes uncommitted Phase 4 fidelity work and instruction/tooling changes. |

The comparison includes working files, not just commits. A branch merge/cherry-pick would miss much of the new work. No remote fetch or live deployment comparison was performed; “Vercel” here means the local checkout, not proof those edits are deployed.

Inventoried **194** selected source/test/script/SQL/config/public/documentation files: **52 identical, 66 different, 50 localhost-only, 26 Vercel-only**. Comparisons normalize CRLF/LF. Appendix lists every file; credentials, private data, history, dependencies, build output, screenshots and tool-private directories are excluded. Counts precede this report. docs/superpowers files are listed only as historical material.

Read both repository instructions and KOS contexts; verified architectural leads in source. Vercel graph query was current. Localhost query withheld a stale graph after a source-fingerprint change; its old graph was not used as source evidence. No graph refresh is required for this documentation-only assessment.

**Phase numbers differ:** localhost Phases 4–7 mean brief/package display, creative guidance, auditor, alternate inputs. Vercel Phase 4 means fidelity and its proposed Phase 5 means measured media/analytics. Use feature names or migration batch IDs below.

**2. Functional differences and direction**

| Area | Localhost | Vercel checkout | Migration decision |
| --- | --- | --- | --- |
| Workspace | Ideas/Scripts/Storyboards/Settings/Activity tabs; keyboard navigation; mounted forms retain unsaved edits; project switch resets state. | Existing page shows stages together, already separating script review and saved storyboards. | Port tabs/styles; preserve cloud recovery actions and approval dispatch. |
| Storyboard reader | Complete cards for all Structure 1/2/3 panels/keyframes; full A/B copy; references/master assets; JSON and escaped printable HTML. Legacy text summary and Structure 1 panel_prompt fallback. | Raw JSON plus selected master/panel fields and fixed panel1/2/3 convenience fields. | Port reader/cards/draft exports; no three-panel display limit or fabricated previews. |
| Production brief | Editable language, planned duration, references and structures; immutable per-item identity/settings/reference/guidance snapshot. | Current project context, no durable per-item brief editor/store. | Port domain/UI; add async cloud storage first. |
| Format selection | All seven nonempty combinations; freezes selection, strips unrequested alternatives, rejects missing selected output; dynamic structure_type mapping. | Any populated faithful format accepted; no operator selector; hardcoded Structure 3 mapping. | Port selector and selected-only persistence, retaining complete per-format fidelity. |
| Creative guidance | Reviewed versioned packs: truthful hooks, clarity, visual continuity, motion endpoints; source adaptation for supplied-script entries. Role-specific use, frozen versions. | Existing prompts plus evidence/editorial safeguards; no versioned packs. | Add packs/snapshots without replacing cloud safeguards. No runtime Codex/KOS tool loading. |
| Script pacing | Per-scene original durations, including mixed beats; optional narrow second-call word-array repair using responseSchema. | Same pause-aware timing utility; validator requires every final scene to match first original duration. Stronger factual/editorial reviews. | Combine mixed-duration preservation with cloud acceptance. Compact repair needs its own factual-review reconciliation. |
| Storyboard fidelity | Numeric scene_number/start_seconds/end_seconds, exact narration/coverage; selected Structure 2 references; cached legacy packages retain usability-only reuse. | Timestamp/time_range and frame aliases; source total/full-voiceover checks; new and cached output checked. | Reconcile both formats and explicit legacy policy before merging gates. |
| QA / Retention Auditor | Separate plan-only audit, evidence-linked findings, heuristic scores, immutable revisions, staleness, editorial acknowledgement, audit-only retry and gated production export. | Absent. | Port after durable cloud stores/workflows. Audit failure must retain generated package. |
| Alternate inputs | Topic → Draft; supplied script adaptation → Draft; transcript or PNG/JPEG still → draft blueprint. Existing idea pipeline independent. | Research/ideas entry route. | Port through cloud dispatch and explicit source/evidence adaptation. |
| Blueprints/variants | Project-owned version/family/parent, approval reason/reviewer/time, archive; frozen recipes/inputs; new variant identity and stable retry identity. | Absent. | Port semantics to existing Postgres; no Vercel JSON sidecars. |
| What If | Optional narrated profile: initial state, structured motion and final state; clips default, explicit panels allowed. | No profile contract. | Port after direct-entry/factual-review reconciliation. |
| Research evidence | Discovery metadata and source/confidence notes with prompt safeguards. | Canonical provider/retrieval observations, factual excerpts, explicit unknowns and cross-platform hypotheses. | Preserve cloud code; backport its structured evidence to local. |
| Editorial acceptance | Prompt safeguards and visual-alignment scene reviews. | Required claim classification/citations/support, useful narration, hook/payoff proof and recent-content originality review. | Keep/backport cloud gates. Post-storyboard auditor is complementary. |
| Recent history | No recentProjectContent method/feed. | Bounded project sample supplied to Idea/Script review and checkpointed on replay. | Backport cohesive feature/tests; do not claim exhaustive duplication checking. |
| Project context | Actual character/style reference values and shared formFrom helper. | Audience/channel/recovery context, but some builders lack local reference-data additions. | Combine reference propagation with cloud evidence/history. |
| Authentication | Process Map sessions and registration file lock. | Injected DB sessions/locks, asynchronous access, shared rate limits. | Preserve destination adapters; never overwrite cloud auth with local Map/file assumptions. |
| Execution/recovery | TaskQueue, file locks, PID/host ownership, startup/interval recovery. | Workflows, durable sleeps, DB leases/fencing, shared cooldowns, provider/history checkpoints, cron maintenance. | Port business behavior through cloud adapters, not local execution machinery. |
| Trend metadata | Local yt-dlp process. | YouTube API in cloud; local yt-dlp option retained. | Keep cloud provider selection and injected search. |
| Storage | Airtable content/users plus local runtime and feature sidecars. | Airtable content/users plus Supabase/Postgres runtime state. | Keep Airtable. New cloud feature state belongs in existing Postgres. |
| Dependencies/build | Vite + Express, no additional dependencies for new features. | Nitro/Workflow/pg/Supabase, build/routing gates, PGlite tests and overrides. | Preserve each manifest/lockfile; do not overwrite or import unnecessary cloud packages locally. |
| Counts/lifecycle | Direct entries add Scripts without fake Idea records; audit readiness separate from Script status. | Same Draft → Approved → Story Generated, plus recovery route and approval-triggered dispatch. | Preserve verified stats/lifecycle. Do not add audit statuses to Airtable Script choices. |

Neither inspected implementation adds real audio measurement, rendering, silent/dialogue/static generation, publishing or measured analytics. Auditor “retention” scores are judgments of a production plan, not viewer measurements.

**3. Important conflicts: resolve before copying code**

1. **Cloud locks/sessions:** local scriptWorker/storyboardWorker hardcode withFileLock; cloud accepts injected withLock from cloud/workflows.js. Local auth removes injected session/lock access. Whole-file copies break cross-instance coordination and session persistence.
2. **Sync versus async:** BriefStore/AuditStore/CreationStore and their callers are synchronous JsonStateFile code. Async DB substitutions require awaited defaults/freeze/get/list/claim/finish throughout routes/workers. Await works with local synchronous returns too. runs/activity.js also assumes synchronous transaction/create/update; give cloud activity an async adapter or existing cloud run path.
3. **No cloud in-process queue:** src/vercel.js injects pipelineQueue: {}, while local new routes require canAccept/tryEnqueue and CreationWorker has a process-local pending set. Add explicit cloud creation/audit controllers and Workflow dispatch, not a process queue.
4. **Proven format conflict:** a pure fixture with numeric fields passes local coverage but fails cloud gate (“needs timestamp or time_range”); a clock/frame fixture passes cloud but fails local coverage. Normalize both in a pure shared view, retain raw JSON and validate contradictory aliases. Audit contracts/time ranges/pointers need the same compatibility, not just the generation prompt.
5. **Pacing correction versus evidence:** keep local per-original-scene duration logic and cloud complete editorial acceptance. Local compact second response has words/visual reviews only; it cannot replace cloud required final-narration claim/citation and overall reviews. Initially retain cloud complete second review. Compact repair is optional only if all changed narration is re-reviewed within the same two-call ceiling. Never attach stale factual reviews to changed words.
6. **Direct-input evidence:** local CreationWorker builds a title/topic concept; cloud expects concept.evidence.factual_sources. Carry relevant bounded supplied excerpts/provenance through canonical evidence. Blueprints, stills and model memory are not factual verification. Accurate contextual/figurative ambiguity should not fail merely for being ambiguous; unsupported safety/factual assertions still need support.
7. **Replay/deferral:** stable job/snapshot/guidance/format/media/audit identities must feed cloud checkpoint namespaces. Successful replay reuses provider output; explicit invalid-audit retry uses a new attempt. Propagate DEFERRED into release/requeue/durable sleep, rather than local catch-all FAILED paths; fence stale claims before committing.
8. **HTTP compatibility:** keep cloud awaits/error middleware, recovery-runs, serialized JSON-array link handling, ownership and onScriptApproved dispatch (also for retried Approved scripts). Mount only local additions with proper adapters.
9. **Transforms:** combine local dynamic structure_type/production_brief with cloud encodeIdeaNotes/decodeIdeaNotes. Whole-file replacement loses evidence on persistence/recovery. Much Airtable-client diff is deletion of old commented code, not a new stats algorithm.
10. **Legacy policy:** local cache reuse is weaker than cloud Phase 4; cloud source precheck is stricter. Keep read/draft export of legacy data and define versioned Approved-work reuse/regeneration rules explicitly. Do not weaken fidelity or bulk regenerate inadvertently. Already Story Generated work remains unchanged; explicit audit can surface legacy blockers.
11. **Audit hashes/pointers:** local audit contract imports the pure client/src/storyboard.js reader (no top-level browser work), and uses numeric timelines. Verify both bundles or move the pure reader to shared ownership. Normalization/rubric changes must retain old report revisions and invalidate readiness when appropriate; finding pointers must still resolve to actual evidence.

**4. Localhost → Vercel: recommended migration batches**

These batches are a proposal, not implementation of the held Phase 5 roadmap.

| Batch | Scope / key files | Stop condition |
| --- | --- | --- |
| M0: preserve baselines | Snapshot both dirty trees, including untracked files; isolated integration branch/worktree before editing. | No blanket merge/reset/cleanup. Code migration needs a new implementation instruction. |
| M1: read-only workspace | App.jsx/styles, storyboard.js/StoryboardPackage, shared display labels: tabs, all-format cards, legacy reader, full copy/JSON/printable draft exports. | Decouple absent audit/brief controls; preserve cloud recovery actions, paging, auth clearing, counts and approval dispatch. Current cloud packages readable/exportable with no new model call or schema requirement. |
| M2: contracts + durable briefs | Async brief domain/store/UI, creativeGuidance, selected structures, reference context, numeric/clock compatibility, mixed-duration validation. | Freeze before first provider call under owning-item lock; same snapshot in manual/scheduled/recovery paths. Preserve cloud evidence and two-call acceptance. All seven output selections pass. |
| M3: durable plan auditor | agents/storyboardAudit, contract/readiness, cloud audit store/workflow/controllers/reconciliation, UI/routes and guarded production export. | Package survives audit failure. Enrollment/intent reconstructs save/status/dispatch gaps. Audit-only retry, immutable revisions, editorial acknowledgement and blocker enforcement proven. |
| M4: direct inputs/blueprints | CreationWorkspace, referenceAnalysis, creation domain/routes/store, cloud jobs; Gemini responseSchema/media support; shared worker snapshot integration. | Topic first; supplied script/transcript next; bounded still images/What If after evidence/media contracts. Stable retry identity, new variants, blueprint approval separate from Script approval. |
| M5: compatibility/cutover | Both test suites, cloud build/replay tests, documentation and optional explicitly requested sidecar import. | No bulk audit/regeneration, measured audio, analytics or publishing. Deploy/live test only after concrete diff review and authorization. |

Start with **M1**: it is mostly UI/reader behavior and provides value without provider calls or new durable state. **M2** is required before the frozen-guidance/auditor/input features. M3/M4 need real cloud adapters; they are not frontend copies. Existing local feature code adds no new package dependencies; durable cloud feature state does require additive DB changes.

**5. Proposed cloud state and execution**

Keep Airtable Users/Projects/Ideas/Scripts/Storyboard. Reuse existing Postgres/Supabase for server-only application state; do not introduce another content database. Extend src/cloud/schema.sql and migration checks additively. Suggested responsibilities (final SQL reviewed during implementation):

| State | Required invariant |
| --- | --- |
| Project brief defaults | Owning Airtable project ID/custom-key relationship, validated editable settings. |
| Item brief snapshots | Unique project + deterministic video identity; immutable settings/identity/references/guidance/recipe snapshot. |
| Blueprint versions | Project/family/parent/version identities; first approval reason/reviewer/time immutable; archive preserves accepted snapshots. |
| Creation jobs | Unique project + request UUID and input hash; snapshot, status, attempt/lease/result; retry keeps video identity. |
| Audit enrollments/intents | Project/script/video enrollment retained across Airtable save and Script status gaps. |
| Audit revisions/reviews | Canonical package/brief/rules/scope hash; immutable report; separate acknowledgement and attempt/lease state. |

Use short transactions/unique constraints and current server-only RLS/revoke posture. Provider/Airtable work stays outside DB transactions. Do not use prunable activity or checkpoint rows as the only home for approvals/reports. Add cloud creation/audit operations using existing leases, capacity limits, cooldowns, durable sleeps and reconciliation.

Workflow inputs should be stable IDs, not credentials or raw image payloads. Load private bounded input on the server. A maximum 512,000-byte reference image can initially use bounded private persisted payload if DB/total-size limits are acceptable; a new object-storage integration is not automatically required. No runtime dependency on Windows paths, installed skills or KOS.

Preserve scoped creation request parsing, 20,000-character source cap, MIME/base64/signature/byte validation and source-instruction isolation. Preserve audit input/report limits of 180,000/60,000 UTF-8 bytes, visible failure and no silent truncation. Reference analysis adds a logical Gemini call; each new audit adds one. Guidance/tabs/structure selection do not add an independent model stage. Provider fallback/retry may add HTTP requests.

**6. Vercel → localhost: useful backports**

| Priority | Shared improvement | Merge conditions |
| --- | --- | --- |
| High | Canonical research/Idea evidence and strategy_notes envelope: utils/evidence.js, affected Research/Idea prompts/schema/index, transforms, tests. | Keep local briefs/guidance and legacy plain notes. Preserve provider/retrieval facts and supplied excerpts, not invented verification. |
| High | Recent project history + factual/claim/hook/usefulness/originality acceptance: airtable.recentProjectContent, utils/editorialReview.js, Script review schema/prompts/worker/tests. | Keep mixed durations, guidance and direct-entry contracts. Review accurate ambiguity in context. Bounded history is not exhaustive originality proof. |
| High | Source total/full-voiceover and cached storyboard fidelity checks. | First reconcile numeric/timestamp formats, local selection, snapshots/audit recovery and explicit legacy reuse. Merge logic rather than replace the file. |
| Medium | Async-compatible lock/store injection and route error handling; shared reference/project context. | Local defaults remain files/Map/TaskQueue. No mandatory pg/Workflow dependency. Preserve local brief/audit/creation recovery. |
| Optional | Dedicated recovery-runs API/button. | Local already has eligible-idea regeneration; add only if separate UX is useful, using the same local worker/queue. |
| Optional | Serialized JSON-array Script link reader. | Test scalar, array and serialized legacy links, including audit ownership. Server resolution remains authoritative. |
| Optional | Official YouTube metadata provider as local option. | Keep working yt-dlp default; enable only if desired because it adds key/quota dependency. |
| Low | Applicable security overrides/comment cleanup. | Check actual local installed dependencies/advisories first; this assessment is not a security audit. No whole cloud manifest copy. |

Do not backport Nitro/Vercel config, cloud workflow runtime, pooled DB sessions, DB-only scheduling/leases, Supabase CA or mandatory YouTube API configuration just to gain shared features. Localhost remains a one-server app. Shared behavior can converge while persistence/execution adapters differ.

**7. Keep separate / exclude / documentation corrections**

Preserve cloud src/vercel.js, src/cloud/* including schema.sql, Nitro/Workflow configuration, API metadata provider, async contracts, injected worker locks, checkpoints, DEFERRED behavior, secure sessions and approval dispatch. Preserve local file durability, recovery tools, local yt-dlp and scheduler/queue.

Exclude .env/credentials, data/*.json, actual input images/text, sessions, persisted schedules/runs, lock directories, node_modules, dist/.vercel, private tool folders, .history/.superpowers, generated graphs and test output. Transfer shared instructions selectively; retain separate KOS routes and deployment commands/scope. Historical GOAL/CODE_REVIEW/DEPLOYMENT_VERIFICATION documents are not current deployed evidence.

Documentation drift: localhost docs/creative-guidance-sources.md says source-adaptation is not selected and Phase 7 is future, while BriefStore.freeze selects that pack for supplied-script mode and its routes already exist. Update that note when porting the feature. Source-hash manifests are provenance, not runtime skill activation. Old graph/test/phase notes are dated snapshots.

**8. Optional data transfer and rollback**

This request authorizes assessment, not data transfer. Code migration will not carry existing local brief/recipe/audit state. A Script before storyboard generation may have its only frozen brief in local sidecar; Airtable alone cannot reconstruct original settings. Some completed packages embed production_brief, but not all approval/history/job state.

1. Stop local schedulers/polls/audit recovery/creation workers for projects moving online. Local file locks do not coordinate with cloud leases on the same Airtable base.
2. Privately back up configured sidecars/cloud state. Add a dry-run importer with owning-project mapping and collision reports before any write; never commit these files.
3. Preserve Airtable record IDs versus custom project keys, deterministic video IDs, request UUIDs, blueprint family/version/first approval, audit hashes/revisions and reviewer decisions. Do not relabel old packages as newly guided/audited.
4. Import defaults/snapshots/blueprints before jobs/reports. Compare embedded and sidecar briefs; quarantine conflicting approved meaning. Preserve old reports and mark incompatible readiness stale. Do not redispatch completed jobs; unfinished local jobs are visibly interrupted unless explicitly selected for resumption.
5. Existing migrate-cloud --import-local handles run/schedule state, not the three new sidecar domains. Extend it only if requested, with opt-in validation/import tests.
6. Install additive schema before new code. Keep new feature dispatch/enrollment disabled until validated. Rollback disables dispatch, drains/stops new workers and restores prior build while preserving content/snapshots/reports and additive tables. Do not delete content/drop data to roll back.

**9. Acceptance checks for implementation**

- Existing login/register/logout, ownership, verified project counts, paging, manual pipeline/recovery, schedules/interruption retry and approval-to-storyboard dispatch continue working.
- Both backends/browsers and cloud build/routing/missing-DB checks pass. Retain local restart/file-lock tests; add DB lease/multi-worker equivalents.
- All seven format combinations, numeric and clock/fractional ranges, silent tails, contradictory aliases, full-voiceover/total mismatch, changed narration, gaps/order/missing coverage and legacy-cache policy tested.
- Mixed-duration and pacing repair still pass complete factual/hook/originality checks. Cover supported excerpts, unsupported safety assertions, supplied sources, clear fictional What If, accurate contextual ambiguity and prompt injection.
- Brief/blueprint snapshots remain unchanged after defaults edits/archive/retry/restart/replay. Conflicting body with same request UUID is rejected; variants get new identity.
- Simulate DEFERRED cooldown, lease loss, duplicate dispatch, lost responses after model/Airtable writes, audit-intent gap and failed Script status update. Do not lose accepted work or replay successful provider calls unnecessarily.
- Audit-only retry works after Story Generated; malformed/missing/stale/blocked reports cannot pass export. Editorial reason acknowledgement cannot override structural blockers or rewrite original verdict.
- Image/source limits, unsupported URL/video/audio, exact transcript quotes, private payload omission and cross-project isolation tested.
- Browser keyboard/mobile/copy/escaped print/JSON export covers legacy, 4+ panels and long prompts. Draft export stays distinct from server-gated production readiness.
- Only after live authorization: isolated Preview DB/providers and one-concept end-to-end proof with real request/record counts. No simultaneous local/cloud automation for the same production projects. Held measured audio/analytics and publishing remain excluded.

**10. Verification for this assessment**

| Check | Current result |
| --- | --- |
| Localhost backend | 221/221 passed |
| Vercel backend, including uncommitted Phase 4 | 189/189 passed |
| Localhost production UI build/browser workflows | 18/18 passed |
| Vercel Nitro/React build and test:vercel | Passed: static/API/Workflow trigger/missing-database checks |
| Vercel browser workflows | 7/7 passed |
| Pure cross-format compatibility | Each native form passes its gate; opposite form rejected |

Logs are in the operator temporary directory: migration-localhost-tests.log, migration-vercel-tests.log, migration-localhost-ui.log, migration-vercel-build.log and migration-vercel-ui.log. Mock provider failures in fixture logs are intentional test cases. No dependency installation, live calls, production record/schema writes, deployment verification, commit, push or branch merge. Generated build/test artifacts refreshed during checks; app source unchanged.

Recommendation: **M1 read-only workspace/cards → M2 shared contracts/durable briefs → cloud-adapted auditor → cloud-adapted direct inputs. Backport evidence/editorial improvements to localhost as separate focused changes.** This is not an audit of every code line or proof of improved creative quality.

**Appendix — complete scoped file inventory**

Identical files need no copy. Different files require selective conflict resolution above. “Only” includes untracked working files; it does not mean deployed. Inventory taken before adding this report.

| File | Comparison |
| --- | --- |
| .env.example | Different |
| .gitignore | Different |
| .graphifyignore | Different |
| AGENTS.md | Different |
| CLAUDE.md | Different |
| CODE_REVIEW.md | Different |
| DEPLOYMENT_VERIFICATION.md | Different |
| GOAL.md | Different |
| Loop.md | Identical |
| README.md | Different |
| VERCEL_MIGRATION.md | Vercel only |
| client/index.html | Identical |
| client/src/App.jsx | Different |
| client/src/BriefEditor.jsx | Localhost only |
| client/src/CreationWorkspace.jsx | Localhost only |
| client/src/StoryboardAudit.css | Localhost only |
| client/src/StoryboardAudit.jsx | Localhost only |
| client/src/StoryboardPackage.jsx | Localhost only |
| client/src/api.js | Identical |
| client/src/main.jsx | Identical |
| client/src/storyboard.js | Localhost only |
| client/src/styles.css | Different |
| docs/CODEX-VSCODE-HANDOFF.md | Localhost only |
| docs/creative-guidance-source-hashes.json | Localhost only |
| docs/creative-guidance-sources.md | Localhost only |
| docs/dashboard-workspace.md | Localhost only |
| docs/fba-workflow-assessment-and-plan.md | Localhost only |
| docs/live-diy-flow-test-2026-10-19.md | Localhost only |
| docs/live-phase7-test-2026-10-20.md | Localhost only |
| docs/localhost-workflow-phased-implementation-plan.md | Localhost only |
| docs/phase-4-5-implementation.md | Localhost only |
| docs/phase-6-auditor.md | Localhost only |
| docs/phase-7-inputs-and-blueprints.md | Localhost only |
| docs/superpowers/plans/2026-08-02-ytdlp-trend-scout.md | Identical |
| docs/superpowers/specs/2026-08-02-ytdlp-trend-scout-design.md | Identical |
| nitro.config.mjs | Vercel only |
| package-lock.json | Different |
| package.json | Different |
| playwright.config.js | Identical |
| public/index.html | Identical |
| scripts/benchmark-dashboard.mjs | Identical |
| scripts/check-vercel-build.mjs | Vercel only |
| scripts/ensure-ui-build.mjs | Identical |
| scripts/migrate-cloud.mjs | Vercel only |
| scripts/recover-state-locks.mjs | Different |
| scripts/setup-project-status.mjs | Identical |
| scripts/test-phase7-live.mjs | Localhost only |
| scripts/verify-gemini-models.mjs | Identical |
| scripts/verify-live-script.mjs | Identical |
| shared/storyboardStructures.js | Localhost only |
| src/agents/idea/index.js | Different |
| src/agents/idea/prompt.js | Different |
| src/agents/idea/schema.json.js | Different |
| src/agents/idea/system.js | Different |
| src/agents/referenceAnalysis/index.js | Localhost only |
| src/agents/referenceAnalysis/prompt.js | Localhost only |
| src/agents/referenceAnalysis/system.js | Localhost only |
| src/agents/research/index.js | Different |
| src/agents/research/prompt.js | Different |
| src/agents/research/system.js | Different |
| src/agents/script/index.js | Identical |
| src/agents/script/prompt.js | Different |
| src/agents/script/system.js | Different |
| src/agents/scriptValidation/index.js | Different |
| src/agents/scriptValidation/prompt.js | Different |
| src/agents/scriptValidation/system.js | Different |
| src/agents/storyboard/index.js | Different |
| src/agents/storyboard/prompt.js | Different |
| src/agents/storyboard/system.js | Different |
| src/agents/storyboardAudit/index.js | Localhost only |
| src/agents/storyboardAudit/prompt.js | Localhost only |
| src/agents/storyboardAudit/system.js | Localhost only |
| src/agents/trendScout/index.js | Different |
| src/agents/trendScout/prompt.js | Identical |
| src/agents/trendScout/system.js | Identical |
| src/app.js | Different |
| src/audits/auditRecovery.js | Localhost only |
| src/audits/auditStore.js | Localhost only |
| src/audits/auditWorker.js | Localhost only |
| src/audits/contract.js | Localhost only |
| src/audits/routes.js | Localhost only |
| src/briefs/briefStore.js | Localhost only |
| src/clients/airtable.js | Different |
| src/clients/gemini.js | Different |
| src/clients/supabase.js | Vercel only |
| src/clients/telegram.js | Identical |
| src/clients/youtube.js | Vercel only |
| src/clients/ytdlp.js | Different |
| src/cloud/context.js | Vercel only |
| src/cloud/controllers.js | Vercel only |
| src/cloud/coordination.js | Vercel only |
| src/cloud/database.js | Vercel only |
| src/cloud/importState.js | Vercel only |
| src/cloud/schedule.js | Vercel only |
| src/cloud/schema.sql | Vercel only |
| src/cloud/state.js | Vercel only |
| src/cloud/supabaseCa.js | Vercel only |
| src/cloud/workflows.js | Vercel only |
| src/config.js | Different |
| src/creation/contract.js | Localhost only |
| src/creation/creationStore.js | Localhost only |
| src/creation/creationWorker.js | Localhost only |
| src/creation/routes.js | Localhost only |
| src/creativeGuidance/index.js | Localhost only |
| src/http/auth.js | Different |
| src/http/passwords.js | Identical |
| src/http/rateLimit.js | Identical |
| src/http/taskQueue.js | Identical |
| src/http/validation.js | Different |
| src/ideaGeneration.js | Different |
| src/ideaRecoveryPipeline.js | Different |
| src/index.js | Different |
| src/pipeline.js | Different |
| src/runIdeaRecovery.js | Identical |
| src/runPipeline.js | Identical |
| src/runStoryboard.js | Different |
| src/runs/activity.js | Identical |
| src/runs/ideaRunController.js | Identical |
| src/runs/runStore.js | Identical |
| src/runs/scriptRunController.js | Different |
| src/schedules/scheduleStore.js | Identical |
| src/schedules/weeklyScheduler.js | Identical |
| src/schemas.js | Identical |
| src/scriptWorker.js | Different |
| src/storyboardPipeline.js | Different |
| src/storyboardPoller.js | Identical |
| src/storyboardWorker.js | Different |
| src/transforms.js | Different |
| src/utils/alerts.js | Identical |
| src/utils/editorialReview.js | Vercel only |
| src/utils/evidence.js | Vercel only |
| src/utils/field.js | Identical |
| src/utils/fileLock.js | Identical |
| src/utils/json.js | Identical |
| src/utils/jsonStateFile.js | Different |
| src/utils/keyPool.js | Identical |
| src/utils/logger.js | Identical |
| src/utils/project.js | Different |
| src/utils/scriptTiming.js | Identical |
| src/utils/storyboardValidation.js | Different |
| src/vercel.js | Vercel only |
| tests/activity.test.js | Different |
| tests/agentInstructions.test.js | Localhost only |
| tests/airtable.test.js | Different |
| tests/auth.test.js | Identical |
| tests/cloud.test.js | Vercel only |
| tests/creation.test.js | Localhost only |
| tests/creativeEvidence.test.js | Vercel only |
| tests/editorialValidation.test.js | Vercel only |
| tests/fileLock.test.js | Identical |
| tests/gemini.test.js | Different |
| tests/helpers/scriptValidation.js | Different |
| tests/helpers/session.js | Identical |
| tests/helpers/storyboard.js | Vercel only |
| tests/helpers/storyboardAudit.js | Localhost only |
| tests/helpers/whatIf.js | Localhost only |
| tests/http.test.js | Different |
| tests/ideaAgent.test.js | Localhost only |
| tests/ideaRecoveryPipeline.test.js | Different |
| tests/ideaRunController.test.js | Identical |
| tests/ideaUpsertProcesses.test.js | Identical |
| tests/lifecycle.test.js | Identical |
| tests/localRestart.test.js | Different |
| tests/productionBrief.test.js | Localhost only |
| tests/researchPrompt.test.js | Different |
| tests/runDurability.test.js | Identical |
| tests/scriptAgent.test.js | Different |
| tests/scriptRunController.test.js | Different |
| tests/scriptValidation.test.js | Different |
| tests/scriptWorker.test.js | Identical |
| tests/sharedState.test.js | Different |
| tests/storyboardAuditContract.test.js | Localhost only |
| tests/storyboardAuditHttp.test.js | Localhost only |
| tests/storyboardAuditWorker.test.js | Localhost only |
| tests/storyboardCoverage.test.js | Localhost only |
| tests/storyboardFidelity.test.js | Vercel only |
| tests/storyboardPipeline.test.js | Different |
| tests/storyboardPoller.test.js | Identical |
| tests/structureSelection.test.js | Localhost only |
| tests/taskQueue.test.js | Identical |
| tests/telegram.test.js | Identical |
| tests/transforms.test.js | Different |
| tests/trendScout.test.js | Identical |
| tests/ui/creation.spec.js | Localhost only |
| tests/ui/dashboard-tabs.spec.js | Localhost only |
| tests/ui/dashboard.spec.js | Different |
| tests/ui/server.mjs | Different |
| tests/ui/storyboard-audit.spec.js | Localhost only |
| tests/uiBuild.test.js | Identical |
| tests/weeklyScheduler.test.js | Identical |
| tests/youtube.test.js | Vercel only |
| tests/ytdlp.test.js | Identical |
| vercel.json | Vercel only |
| vite.config.js | Identical |
