# Vercel V0 baseline — 2026-10-24

**Target:** D:\GitHub\storyboard-automation-project-v4
**Scope:** Preparation and verification only. No V1 implementation, migration, deployment, live generation, schedule update or content mutation.

Companion: [V0–V7 implementation plan](vercel-phased-implementation-plan-2026-10-23.md). The [source manifest](vercel-v0-source-manifest-2026-10-24.md) records exact selected worktree files, including the localhost changes already present at capture.

## 1. Source and rollback baseline

| Role | Revision | Branch | Application state |
|---|---|---|---|
| Vercel target | 348fd9f6b157115820c7a23b012dc8f2e56b91f7 | main | No pending source/test/config changes |
| Localhost reference | 9b850702349745ac4a88d4f1b7dfe5d2a80fe9a2 | localhost-merge-2026-10-23 | Existing uncommitted changes included in manifest |
| Chat default workspace | version-3 checkout | Not a target | Not modified |

Vercel's existing modified historical-assessment pointer, untracked comparison/plan documents and generated graphify-out were preserved. Nothing was staged, committed, reset or cleaned.

Localhost has advanced beyond the clean-commit observation in the October 23 plan. At capture, pending paths were:

- client/src/App.jsx
- docs/phased-v4-merge-plan-2026-10-23.md
- src/agents/storyboard/index.js
- src/utils/storyboardValidation.js
- tests/activity.test.js, productionBrief.test.js, storyboardCoverage.test.js, storyboardFidelity.test.js, storyboardPipeline.test.js, structureSelection.test.js
- tests/ui/dashboard.spec.js
- New local phase-4, phase-5 and baseline documents; generated graphify-out.

These are pre-existing reference changes, not Vercel ports. The manifest captures the current raw source bytes. Re-review these diffs before importing V2 compatibility changes; do not infer their behavior or verification from local HEAD alone.

Runtime used: **Node v24.14.1, npm 11.11.0**. Dependencies were already installed; no install/update was needed. Repository-wide instructions were read; scoped subdirectory instruction search is recorded in the final audit.

Selected source manifests: Vercel 145 files and localhost 151 files across src/client/shared/tests/scripts and root dependency/build configurations. These differ from the older 212-file comparison inventory because documentation scope and normalization differ. No credential/environment/history/runtime files were hashed into the published manifest.

**Application rollback candidate:** 348fd9f. This is the verified source baseline, not a claim that the production alias currently points to it. Keep its immutable source available for the V1 release; do not perform a destructive Git reset to roll back.

## 2. Fresh verification

| Check | Result |
|---|---|
| Initial npm test, overlapping browser load | 209/210 passed; one timing-sensitive completion assertion failed |
| node --test tests/creativeEvidence.test.js | 7/7 passed in isolation |
| npm test after browser suite finished | 210/210 passed, 13.3 seconds |
| npm run test:ui | 13/13 passed, 1.9 minutes; isolated mocked server/providers |
| npm run test:vercel | Passed: React/Nitro build, static/API routing, Workflow queue trigger and missing-database/cron authorization checks |
| git diff --check | Passed |
| KOS Vercel graph query/status | Current; original source seams verified |

The initial failure was tests/creativeEvidence.test.js:113: expected COMPLETED, observed RUNNING. Its preceding loop waits at most 200 setImmediate iterations rather than an elapsed-time completion deadline. The unchanged test passed in isolation and the complete unchanged backend suite passed after browser load ended. This supports classifying the observation as a timing-sensitive baseline test, not an introduced regression; it does not prove the failure can never recur. No test/product fix or additional polling change was made in V0.

The build gate explicitly disables database configuration and probes emitted static routing, API fail-closed initialization, Workflow queue trigger and cron authorization. The mocked suites do not prove live Gemini/Airtable/Telegram behavior. No fresh localhost test suite was run: localhost is a read-only port reference, not this phase's implementation target.

Private, gitignored evidence:

- data/vercel-v0-baseline-20261024.json — revisions, dirty-state snapshot, per-file hashes, environment versions, deployment metadata, state summary and future test protocol.
- data/vercel-v0-state-20261024.json — read-only aggregate database observation.
- Test command logs: v0-vercel-backend-20261024.log, v0-vercel-evidence-focused-20261024.log, v0-vercel-backend-rerun-20261024.log, v0-vercel-ui-20261024.log and v0-vercel-build-20261024.log in the current user's temporary directory; copies are preserved under data/vercel-v0-logs-20261024/.

## 3. Deployment and operational observation

The authenticated GitHub connector returned a successful **Vercel** status attached to commit 348fd9f, with [deployment-check detail](https://vercel.com/ranz-s-projects/storyboard-automation-project/8FopWS8UsxXJDBPCmdwZEZWA9PXX).

**Production alias revision remains unverified.** A successful commit check is not proof that https://storyboard-automation-project.vercel.app/ currently serves that revision. Vercel CLI is unavailable, GitHub CLI is unauthenticated, and the GitHub connector's generic fetch rejects the deployment-list endpoint. No production authentication, alias reassignment or deployment was performed to close this gap. Capture the actual Production deployment revision through authorized deployment access before a release.

Read-only queries against the locally configured database, at **2026-10-24 02:07:33 Asia/Singapore**, found:

| Observation | Count |
|---|---:|
| QUEUED/RUNNING app runs | 0 |
| Enabled schedules | 3 |
| COMPLETED runs | 18 |
| FAILED runs | 7 |
| PARTIAL runs | 2 |
| Project brief defaults | 1 |
| Item brief snapshots | 10 |
| Provider/app replay effects | 214 |

Queries ran in BEGIN READ ONLY and ended with ROLLBACK. Only aggregates were retained; no content, password, session or credential values were printed.

This is the configured database observation. Its binding to the currently deployed environment was not independently attested. It is also a point-in-time snapshot: three schedules remain enabled and can create work later. Recheck the actual production database and active/queued jobs immediately before any future rollout. V0 did not disable schedules or invoke cron/reconciliation.

## 4. Controlled future test protocol

No test Project/account was created or mutated in V0.

- Use a dedicated Project named **Vercel migration acceptance**, owned by the existing operator account through ordinary authenticated login. Resolve/create and record its actual ownership/ID before the first authorized live test; do not substitute a routine production Project.
- Test identity is reserved, not yet provisioned or attested. Existing account credentials remain private; do not add a privileged test account or bypass login.
- V0 allows mocked service execution and the aggregate read-only database checks above. It does not authorize Gemini generation, Airtable content writes, Telegram alerts or production schedule changes.
- A later live-test request must state the one-item path and whether Gemini quota, Airtable content writes, app-state writes and Telegram alerts are included. Preserve human Script/blueprint approval. Keep due production schedules isolated.
- Inspect persisted identities/snapshots and failed-step-only retry; do not mark an untested path complete because an isolated Idea diagnostic once passed.

## 5. Backup and rollback procedure for later phases

No schema expansion or backup was executed in V0. Before the first expansion:

1. Confirm the actual target environment/database and the immutable application revision to restore.
2. Pause new job starts and scheduled dispatch within the separately authorized rollout scope; drain existing jobs or establish a tested fence. Do not run localhost and cloud schedulers against the same production Airtable base.
3. Take a private managed-database snapshot or logical backup covering all app_* state, including runs, schedules, immutable briefs and effects. Record timestamp, restore point and responsible operator without recording connection secrets. Confirm backup availability and test restoration to an isolated database before relying on it.
4. Preserve relevant Airtable records/IDs and their ownership/status; app rollback must not delete generated content or change Airtable schemas.
5. Apply only reviewed additive migrations, verify repeatability and existing readers, then deploy compatible code. Never run --import-local for these feature ports.
6. On rollback, stop incompatible new dispatch, restore the compatible application revision and retain additive tables/snapshots/jobs. Resume only with a compatible worker. Do not force unfinished jobs to success or replay successful provider effects unnecessarily.

Backup/restore availability is a pre-expansion release gate, not claimed verified here. V1/V2 have no new tables, but their prompt/review replay compatibility and current active/schedule state still require review.

## 6. V0 exit audit

| V0 requirement | Evidence / disposition |
|---|---|
| Exact target/source and worktree state | Commits/branches above; published source manifest includes local uncommitted bytes |
| Preserve existing changes; no unrelated staged content | Application source unchanged; no staging/reset/cleanup |
| Fresh baseline failures classified | Initial timing assertion retained in evidence; isolated and full reruns pass |
| Backend/browser/build gates | Fresh results above; Passed: 210 backend, 13 browser and Vercel build/routing gate |
| Deployed revision or explicit gap | Matching commit check verified; production alias/database binding explicitly unverified |
| Active runs/schedules identified before later rollout | Configured database: 0 active, 3 enabled schedules; must recheck production at rollout |
| Controlled test protocol and side-effect limits | Reserved isolated Project/normal operator login; no provisioning/live generation in V0 |
| Rollback revision/state preservation procedure | 348fd9f plus pre-expansion backup/restore and drain/fence procedure |
| Stop at V0 | No source/schema/runtime mutation, deployment, provider generation or V1 work |

**V0 is complete as a source/verification baseline with the explicit release gaps above. V1 has not started.**

Remaining release gaps are production alias/database binding, actual test Project/account binding, verified backup/restore before expansion, and the timing-sensitive baseline test. They are documented constraints for later work, not claims of completed live verification.


Final source-fingerprint audit: Vercel application/test/config files unchanged since capture. Local reference files changed after capture: none among the captured files. Local source remains read-only for this task.
