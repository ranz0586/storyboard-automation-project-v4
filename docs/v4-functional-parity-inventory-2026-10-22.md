# File and API inventory — 2026-10-22

Companion to [the comparison and merge plan](v4-functional-parity-comparison-2026-10-22.md). Captures both current worktrees, including local uncommitted changes; excludes this newly written report/appendix. Line endings and leading file BOM are normalized for file equality. Private/runtime/dependency/build/history/tool material is excluded. No environment values are included.

## File inventory

212 union files: 47 identical, 77 different, 53 localhost-only, 35 Vercel-only. Classification is textual, not a count of missing features. The main report explains business and hosting differences.

| File | State | Vercel lines | Localhost lines |
|---|---|---:|---:|
| .env.example | different | 98 | 91 |
| .gitignore | different | 21 | 10 |
| .graphifyignore | different | 17 | 37 |
| AGENTS.md | different | 159 | 152 |
| CLAUDE.md | different | 155 | 136 |
| CODE_REVIEW.md | different | 62 | 39 |
| DEPLOYMENT_VERIFICATION.md | different | 134 | 34 |
| GOAL.md | different | 1347 | 1347 |
| README.md | different | 178 | 164 |
| VERCEL_MIGRATION.md | Vercel-only | 76 | — |
| client/index.html | identical | 13 | 13 |
| client/src/App.jsx | different | 343 | 345 |
| client/src/BriefEditor.jsx | localhost-only | — | 62 |
| client/src/CreationWorkspace.jsx | localhost-only | — | 74 |
| client/src/OutputSettings.jsx | Vercel-only | 75 | — |
| client/src/StoryboardAudit.css | localhost-only | — | 23 |
| client/src/StoryboardAudit.jsx | localhost-only | — | 83 |
| client/src/StoryboardPackage.jsx | different | 46 | 67 |
| client/src/api.js | identical | 20 | 20 |
| client/src/main.jsx | identical | 7 | 7 |
| client/src/storyboard.js | different | 46 | 46 |
| client/src/styles.css | different | 518 | 537 |
| docs/CODEX-VSCODE-HANDOFF.md | localhost-only | — | 228 |
| docs/creative-guidance-source-hashes.json | localhost-only | — | 37 |
| docs/creative-guidance-sources.md | localhost-only | — | 18 |
| docs/dashboard-port.md | Vercel-only | 20 | — |
| docs/dashboard-workspace.md | localhost-only | — | 27 |
| docs/editorial-and-storyboard-validation.md | localhost-only | — | 52 |
| docs/evidence-persistence.md | localhost-only | — | 20 |
| docs/fba-workflow-assessment-and-plan.md | localhost-only | — | 322 |
| docs/invalid-json-retry.md | localhost-only | — | 25 |
| docs/live-diy-flow-test-2026-10-19.md | localhost-only | — | 36 |
| docs/live-phase7-test-2026-10-20.md | localhost-only | — | 50 |
| docs/localhost-backport-revalidation-2026-10-21.md | localhost-only | — | 36 |
| docs/localhost-vercel-migration-assessment-2026-10-21.md | Vercel-only | 365 | — |
| docs/localhost-vercel-validation-comparison.md | localhost-only | — | 14 |
| docs/localhost-workflow-phased-implementation-plan.md | localhost-only | — | 214 |
| docs/output-selection-and-guidance.md | Vercel-only | 37 | — |
| docs/phase-4-5-implementation.md | localhost-only | — | 58 |
| docs/phase-6-auditor.md | localhost-only | — | 59 |
| docs/phase-7-inputs-and-blueprints.md | localhost-only | — | 51 |
| docs/production-briefs.md | Vercel-only | 21 | — |
| docs/recent-content-comparisons.md | localhost-only | — | 20 |
| nitro.config.mjs | Vercel-only | 9 | — |
| package-lock.json | different | 8807 | 1885 |
| package.json | different | 56 | 39 |
| playwright.config.js | identical | 22 | 22 |
| public/index.html | identical | 1103 | 1103 |
| scripts/benchmark-dashboard.mjs | identical | 120 | 120 |
| scripts/check-vercel-build.mjs | Vercel-only | 47 | — |
| scripts/ensure-ui-build.mjs | identical | 15 | 15 |
| scripts/migrate-cloud.mjs | Vercel-only | 32 | — |
| scripts/recover-state-locks.mjs | different | 14 | 14 |
| scripts/setup-project-status.mjs | identical | 35 | 35 |
| scripts/test-phase7-live.mjs | localhost-only | — | 73 |
| scripts/verify-gemini-models.mjs | identical | 37 | 37 |
| scripts/verify-live-script.mjs | identical | 89 | 89 |
| shared/storyboardStructures.js | different | 22 | 22 |
| src/agents/idea/index.js | different | 16 | 18 |
| src/agents/idea/prompt.js | different | 45 | 42 |
| src/agents/idea/schema.json.js | different | 113 | 76 |
| src/agents/idea/system.js | different | 480 | 486 |
| src/agents/referenceAnalysis/index.js | localhost-only | — | 10 |
| src/agents/referenceAnalysis/prompt.js | localhost-only | — | 2 |
| src/agents/referenceAnalysis/system.js | localhost-only | — | 2 |
| src/agents/research/index.js | different | 17 | 16 |
| src/agents/research/prompt.js | different | 66 | 76 |
| src/agents/research/system.js | different | 260 | 263 |
| src/agents/script/index.js | identical | 33 | 33 |
| src/agents/script/prompt.js | different | 58 | 61 |
| src/agents/script/system.js | different | 374 | 372 |
| src/agents/scriptValidation/index.js | different | 91 | 139 |
| src/agents/scriptValidation/prompt.js | different | 41 | 53 |
| src/agents/scriptValidation/system.js | different | 53 | 38 |
| src/agents/storyboard/index.js | different | 22 | 24 |
| src/agents/storyboard/prompt.js | different | 68 | 61 |
| src/agents/storyboard/system.js | different | 759 | 765 |
| src/agents/storyboardAudit/index.js | localhost-only | — | 9 |
| src/agents/storyboardAudit/prompt.js | localhost-only | — | 17 |
| src/agents/storyboardAudit/system.js | localhost-only | — | 8 |
| src/agents/trendScout/index.js | different | 69 | 67 |
| src/agents/trendScout/prompt.js | identical | 22 | 22 |
| src/agents/trendScout/system.js | identical | 18 | 18 |
| src/app.js | different | 410 | 385 |
| src/audits/auditRecovery.js | localhost-only | — | 50 |
| src/audits/auditStore.js | localhost-only | — | 99 |
| src/audits/auditWorker.js | localhost-only | — | 89 |
| src/audits/contract.js | localhost-only | — | 148 |
| src/audits/routes.js | localhost-only | — | 64 |
| src/briefs/briefStore.js | different | 31 | 63 |
| src/briefs/contract.js | Vercel-only | 43 | — |
| src/clients/airtable.js | different | 627 | 476 |
| src/clients/gemini.js | different | 107 | 117 |
| src/clients/supabase.js | Vercel-only | 17 | — |
| src/clients/telegram.js | identical | 54 | 54 |
| src/clients/youtube.js | Vercel-only | 55 | — |
| src/clients/ytdlp.js | different | 64 | 61 |
| src/cloud/briefStore.js | Vercel-only | 27 | — |
| src/cloud/context.js | Vercel-only | 108 | — |
| src/cloud/controllers.js | Vercel-only | 73 | — |
| src/cloud/coordination.js | Vercel-only | 98 | — |
| src/cloud/database.js | Vercel-only | 48 | — |
| src/cloud/importState.js | Vercel-only | 46 | — |
| src/cloud/schedule.js | Vercel-only | 25 | — |
| src/cloud/state.js | Vercel-only | 289 | — |
| src/cloud/supabaseCa.js | Vercel-only | 5 | — |
| src/cloud/workflows.js | Vercel-only | 316 | — |
| src/config.js | different | 106 | 110 |
| src/creation/contract.js | localhost-only | — | 51 |
| src/creation/creationStore.js | localhost-only | — | 45 |
| src/creation/creationWorker.js | localhost-only | — | 43 |
| src/creation/routes.js | localhost-only | — | 50 |
| src/creativeGuidance/index.js | different | 23 | 25 |
| src/http/auth.js | different | 148 | 141 |
| src/http/passwords.js | identical | 21 | 21 |
| src/http/rateLimit.js | identical | 35 | 35 |
| src/http/taskQueue.js | identical | 50 | 50 |
| src/http/validation.js | different | 77 | 66 |
| src/ideaGeneration.js | different | 50 | 50 |
| src/ideaRecoveryPipeline.js | different | 109 | 95 |
| src/index.js | different | 47 | 56 |
| src/pipeline.js | different | 129 | 129 |
| src/runIdeaRecovery.js | different | 28 | 27 |
| src/runPipeline.js | different | 41 | 39 |
| src/runStoryboard.js | different | 27 | 35 |
| src/runs/activity.js | identical | 19 | 19 |
| src/runs/ideaRunController.js | identical | 68 | 68 |
| src/runs/runStore.js | identical | 134 | 134 |
| src/runs/scriptRunController.js | different | 268 | 248 |
| src/schedules/scheduleStore.js | identical | 90 | 90 |
| src/schedules/weeklyScheduler.js | identical | 121 | 121 |
| src/schemas.js | identical | 139 | 139 |
| src/scriptWorker.js | different | 81 | 87 |
| src/storyboardPipeline.js | different | 56 | 56 |
| src/storyboardPoller.js | identical | 27 | 27 |
| src/storyboardWorker.js | different | 48 | 72 |
| src/transforms.js | different | 217 | 217 |
| src/utils/alerts.js | identical | 14 | 14 |
| src/utils/editorialReview.js | different | 48 | 82 |
| src/utils/evidence.js | different | 46 | 47 |
| src/utils/field.js | identical | 4 | 4 |
| src/utils/fileLock.js | identical | 53 | 53 |
| src/utils/json.js | different | 54 | 42 |
| src/utils/jsonStateFile.js | different | 122 | 122 |
| src/utils/keyPool.js | identical | 52 | 52 |
| src/utils/logger.js | identical | 15 | 15 |
| src/utils/project.js | different | 28 | 46 |
| src/utils/scriptTiming.js | identical | 54 | 54 |
| src/utils/storyboardValidation.js | different | 154 | 190 |
| src/vercel.js | Vercel-only | 77 | — |
| tests/activity.test.js | different | 54 | 53 |
| tests/agentInstructions.test.js | localhost-only | — | 100 |
| tests/airtable.test.js | different | 434 | 419 |
| tests/auth.test.js | identical | 189 | 189 |
| tests/cloud.test.js | Vercel-only | 471 | — |
| tests/creation.test.js | localhost-only | — | 108 |
| tests/creativeEvidence.test.js | Vercel-only | 133 | — |
| tests/editorialAcceptance.test.js | localhost-only | — | 215 |
| tests/editorialValidation.test.js | Vercel-only | 123 | — |
| tests/evidencePersistence.test.js | localhost-only | — | 81 |
| tests/fileLock.test.js | identical | 102 | 102 |
| tests/gemini.test.js | different | 116 | 129 |
| tests/helpers/scriptValidation.js | different | 42 | 45 |
| tests/helpers/session.js | identical | 20 | 20 |
| tests/helpers/storyboard.js | Vercel-only | 15 | — |
| tests/helpers/storyboardAudit.js | localhost-only | — | 22 |
| tests/helpers/whatIf.js | localhost-only | — | 19 |
| tests/http.test.js | different | 298 | 296 |
| tests/ideaAgent.test.js | localhost-only | — | 48 |
| tests/ideaRecoveryPipeline.test.js | different | 162 | 219 |
| tests/ideaRunController.test.js | identical | 85 | 85 |
| tests/ideaUpsertProcesses.test.js | identical | 57 | 57 |
| tests/json.test.js | Vercel-only | 29 | — |
| tests/lifecycle.test.js | identical | 150 | 150 |
| tests/localRestart.test.js | different | 101 | 112 |
| tests/outputSelection.test.js | Vercel-only | 152 | — |
| tests/outputSettingsHttp.test.js | Vercel-only | 44 | — |
| tests/productionBrief.test.js | localhost-only | — | 149 |
| tests/recentContent.test.js | localhost-only | — | 146 |
| tests/researchPrompt.test.js | different | 31 | 58 |
| tests/runDurability.test.js | identical | 143 | 143 |
| tests/scriptAgent.test.js | different | 55 | 75 |
| tests/scriptRunController.test.js | different | 256 | 238 |
| tests/scriptValidation.test.js | different | 305 | 375 |
| tests/scriptWorker.test.js | identical | 158 | 158 |
| tests/sharedState.test.js | different | 155 | 153 |
| tests/storyboardAuditContract.test.js | localhost-only | — | 151 |
| tests/storyboardAuditHttp.test.js | localhost-only | — | 136 |
| tests/storyboardAuditWorker.test.js | localhost-only | — | 280 |
| tests/storyboardCoverage.test.js | localhost-only | — | 67 |
| tests/storyboardDisplay.test.js | Vercel-only | 39 | — |
| tests/storyboardFidelity.test.js | different | 129 | 88 |
| tests/storyboardPipeline.test.js | different | 164 | 199 |
| tests/storyboardPoller.test.js | identical | 51 | 51 |
| tests/structureSelection.test.js | localhost-only | — | 90 |
| tests/taskQueue.test.js | identical | 37 | 37 |
| tests/telegram.test.js | identical | 24 | 24 |
| tests/transforms.test.js | different | 62 | 72 |
| tests/trendScout.test.js | identical | 26 | 26 |
| tests/ui/creation.spec.js | localhost-only | — | 91 |
| tests/ui/dashboard-port.spec.js | Vercel-only | 101 | — |
| tests/ui/dashboard-tabs.spec.js | identical | 48 | 48 |
| tests/ui/dashboard.spec.js | different | 276 | 461 |
| tests/ui/output-settings.spec.js | Vercel-only | 96 | — |
| tests/ui/server.mjs | different | 151 | 224 |
| tests/ui/storyboard-audit.spec.js | localhost-only | — | 110 |
| tests/uiBuild.test.js | identical | 42 | 42 |
| tests/weeklyScheduler.test.js | identical | 166 | 166 |
| tests/youtube.test.js | Vercel-only | 90 | — |
| tests/ytdlp.test.js | identical | 60 | 60 |
| vercel.json | Vercel-only | 13 | — |
| vite.config.js | identical | 16 | 16 |

## API inventory

Literal/constant-prefix Express route scan plus manual verification of the generated auth action loop: 23 Vercel and 32 local endpoints, with 22 shared. The cloud cron wrapper adds one cloud-only endpoint outside Express. Static/health routes and retired POST /niche (410 in both) are not counted as dashboard APIs. Mount order, authorization and runtime behavior remain part of the source contract.

| Method/path | Vercel source | Localhost source |
|---|---|---|
| GET /api/auth/me | src/http/auth.js:136 | src/http/auth.js:131 |
| GET /api/projects | src/app.js:141 | src/app.js:134 |
| GET /api/projects/:id | src/app.js:187 | src/app.js:180 |
| GET /api/projects/:id/brief | src/app.js:123 | src/app.js:212 |
| GET /api/projects/:id/creation | — | src/creation/routes.js:12 |
| GET /api/projects/:id/ideas | src/app.js:283 | src/app.js:279 |
| GET /api/projects/:id/schedule | src/app.js:374 | src/app.js:353 |
| GET /api/projects/:id/scripts | src/app.js:219 | src/app.js:227 |
| GET /api/projects/:id/scripts/:scriptId/production-export | — | src/audits/routes.js:55 |
| GET /api/projects/:id/scripts/:scriptId/storyboard-audit | — | src/audits/routes.js:20 |
| GET /api/projects/:id/storyboards | src/app.js:233 | src/app.js:240 |
| GET /api/script-runs | src/app.js:350 | src/app.js:329 |
| GET /api/script-runs/:id | src/app.js:354 | src/app.js:333 |
| PATCH /api/projects/:id/status | src/app.js:202 | src/app.js:195 |
| POST /api/auth/login | src/http/auth.js:104 | src/http/auth.js:99 |
| POST /api/auth/logout | src/http/auth.js:137 | src/http/auth.js:132 |
| POST /api/auth/register | src/http/auth.js:104 | src/http/auth.js:99 |
| POST /api/projects | src/app.js:161 | src/app.js:154 |
| POST /api/projects/:id/blueprints | — | src/creation/routes.js:13 |
| POST /api/projects/:id/blueprints/:blueprintId/approve | — | src/creation/routes.js:17 |
| POST /api/projects/:id/blueprints/:blueprintId/archive | — | src/creation/routes.js:21 |
| POST /api/projects/:id/creation-jobs | — | src/creation/routes.js:22 |
| POST /api/projects/:id/creation-jobs/:jobId/retry | — | src/creation/routes.js:44 |
| POST /api/projects/:id/idea-runs | src/app.js:298 | src/app.js:294 |
| POST /api/projects/:id/pipeline-runs | src/app.js:328 | src/app.js:307 |
| POST /api/projects/:id/recovery-runs | src/app.js:312 | — |
| POST /api/projects/:id/scripts/:scriptId/approve | src/app.js:257 | src/app.js:257 |
| POST /api/projects/:id/scripts/:scriptId/storyboard-audit | — | src/audits/routes.js:26 |
| POST /api/projects/:id/scripts/:scriptId/storyboard-audit/review | — | src/audits/routes.js:43 |
| POST /api/script-runs | src/app.js:337 | src/app.js:316 |
| POST /api/script-runs/:id/retry | src/app.js:360 | src/app.js:339 |
| PUT /api/projects/:id/brief | src/app.js:131 | src/app.js:218 |
| PUT /api/projects/:id/schedule | src/app.js:378 | src/app.js:357 |
| GET /api/cron | src/vercel.js:40, secret-protected wrapper | — |

## Offline compatibility evidence

| Check | Result | Detail |
|---|---|---|
| cloud clock generation | accepted | — |
| cloud numeric generation | rejected | Storyboard fidelity: structure1[0] needs a timestamp or time_range |
| local clock generation | rejected | Incomplete storyboard: frame order, timing and narration must match scene 1 |
| local numeric generation | accepted | — |
| local clock cached package | accepted | — |
| cloud literal fences in JSON | accepted | — |
| local literal fences in JSON | rejected | extractJson: no JSON found in response |

These fixtures use synthetic content and the current exported functions. They do not assert every historical Airtable record is compatible or attest a deployed revision. Source fingerprint recheck returned zero changes against the captured inventory before report creation.

## Brief compatibility evidence

An in-memory store check set language/reference defaults, updated selection alone, then froze an item and changed live Project reference assets.

| Check | Vercel | Localhost |
|---|---|---|
| Omitted language and description preserved on selection-only update | Yes | No: reset to defaults |
| Frozen character/style assets restored after live Project values change | Yes | No: newer live values remain |

These behaviors were asserted against current exported BriefStore/formWithBrief functions; no provider or persistent user-state operations were needed.
