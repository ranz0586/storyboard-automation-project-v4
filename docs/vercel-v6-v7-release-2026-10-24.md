# V6 implementation and V7 release evidence — 2026-10-24

V6 ports the existing localhost production-plan review into the Vercel Storyboards reader. It preserves the dashboard, numeric/clock scene compatibility, saved formats, clipboard and draft exports. Current review readiness comes from the authenticated server, not browser data. Findings navigate the corresponding saved cards with keyboard focus.

## Review and export

POST `/api/projects/:id/scripts/:scriptId/storyboard-audit/review` accepts `{auditId, reason}`. The server loads owned current content and serializes review against new audit revisions by locking the enrollment. Only COMPLETE, current NEEDS_REVIEW reports without blocking findings and with passed source checks are eligible. Authenticated reviewer identity, reason, timestamp and exact fingerprint are immutable; matching retries are idempotent. Reports and verdicts are untouched.

GET `/api/projects/:id/scripts/:scriptId/production-export` rejects missing, stale, pending, failed or blocked audits with 409. It returns the exact loaded owned package that passed readiness; a second source/latest-report read rejects observed concurrent changes. This is not an atomic freeze across Airtable and PostgreSQL. A subsequent external edit cannot retroactively change the downloaded snapshot. Paused project reads/exports remain available; new audits/acknowledgements require an active project.

The reader shows legacy unaudited, pending/running, failure, stale and completed states; retries audit only. Errors retain the review reason and existing selections. Production sheets use only the server-returned package and escape saved content. Draft sheets/JSON and audit report downloads remain available. Text-plan review does not assess rendered media or measure retention.

## Migration and rollout

V6 needs no new columns or tables: acknowledgements use the existing app_audits JSON payload. Retain V3–V5 additive schema, server-only roles/indexes and prior audit revisions. Never import local state during deployment. Deploy UI, API and durable Workflow handlers together, then attest the hosted asset revision and verify ownership/readiness live.

## Rollback

Disable new production-export/review actions first if reverting incompatible readiness code. Preserve draft exports, Airtable content, audit reports and immutable reviewer history. Do not drop tables, mass-reset Script status or import local schedules/sessions. Use a compatible worker to reconcile any queued work.

## Verification

Release gates and live acceptance results are appended after execution. Unit/HTTP/browser tests mock providers and Airtable; they cannot certify hosted delivery, live quota availability or operator approval. Required human Script/blueprint approvals remain pending until the operator reviews concrete artifacts.


Initial final-source gates: 248/248 backend tests passed using `node --test --test-concurrency=1 "tests/**/*.test.js"` (exit 0). `npm run test:vercel` passed (exit 0), including static/API routing, Workflow queue triggers and missing-database fail-closed checks. The one-time V6 UI detector returned no findings; desktop and 390px mobile browser captures inspected, with no horizontal overflow. Focused HTTP and browser review tests pass. Browser tests were updated to permit the now-supported audit GET while continuing to prohibit automatic audit mutations/production-export requests during draft export.

Live schema verification saved a private six-table production-state backup (21 rows), restored it into isolated PGlite and verified row counts. The unchanged additive schema ran twice against configured Supabase. All six production/brief tables retain RLS and deny anon/authenticated direct access; required indexes and completed audit reports are intact. This is not a full database/PITR recovery drill. No local state was imported.

Full browser gate: `npm run test:ui` passed 17/17 (exit 0). Providers/Airtable are mocked. Hosted acceptance is tracked separately below.


## Hosted checkpoint — V7 in progress

Code release `6e37925` is pushed to main and Vercel reports deployment success. Production's `/assets/index-BsLv7AOM.js` matches the locally tested bundle byte-for-byte (SHA-256 `c9ef94ac54101ed7a90e743e7d7fb06f20413a116f7ee6c471c225b93b5c46cb`). Health, configured-account login, project capabilities and brief reads pass. Unauthenticated cron is rejected. The production export API rejects the existing unacknowledged NEEDS_REVIEW package, and acknowledgement with the wrong report ID returns 409. Authenticated React reader checked at 1440/390px with no page errors/overflow; current NEEDS_REVIEW and legacy Unaudited states are distinct.

One direct supplied-fiction job `31145941-4908-4199-ae13-b45cfdb002d2` completed and saved Draft Script `rec8k6ZG4P4iV5dQT`, fixed video identity `idea_entry_31145941-4908-4199-ae13-b45cfdb002d2`. Its five 3-second scenes/15-second narration pass timing; owning project is Science_Explainers, frozen profile is what-if and selected output is Structure 1. Two successful provider-response checkpoints are saved. No Idea row was created by direct entry.

Reference analysis job `3823cb4b-c73c-40bd-98de-eeb104c45342` completed after waiting for execution capacity and saved Draft blueprint `c02efd85-7db4-46c0-9fbd-c533eac1049f`, Progressive Activation Sequence. Transcript quotes and explicit limits are retained; one successful provider-response checkpoint is saved. Checkpoint counts do not reveal individual HTTP retries, fallback usage or quota errors.

Actual human approval has been requested for that Script and blueprint and for acknowledgement of existing audit `dc452145-c11c-409e-b277-c7514e36c67e`. None has been silently approved. The blueprint-derived new Draft, new Script-to-storyboard automatic audit handoff and accepted production export remain pending those decisions. V7 is not complete.

A separate one-item legacy selected generation run `4eb3ed23-823b-486e-94b0-adb06fd3bf74` uses existing Idea `recz8dCKvLqfpVMaw`. For this bounded test only, its evidence notes include short excerpts from the [original doorway study](https://www.tandfonline.com/doi/abs/10.1080/17470218.2011.571267) and the [later mixed-results investigation](https://pmc.ncbi.nlm.nih.gov/articles/PMC7938580/), with instructions to remove unsupported deletion/brain-mechanism claims and preserve uncertainty. A private backup and finally-block restoration preserve the original notes; the run result and restoration are recorded below when observed.

Private gitignored evidence: data/vercel-v67-live-20261024.json, vercel-v67-direct-script-20261024.json, vercel-v67-blueprint-20261024.json, vercel-v67-legacy-20261024.json and vercel-v67-schema-20261024.json. No credential values are included in this document.

Remaining operational limits: no full database/PITR restore drill, destructive live crash test or authenticated cron execution against unrelated due schedules. Scheduled/manual/selected/count/recovery compatibility and destructive crash windows are covered by isolated tests; no live weekly occurrence was fired. Primary/fallback model-level outcomes have not been observed through hosted logs. Do not equate this checkpoint with full V7 acceptance.


Legacy run observation ended after 15 minutes without a terminal result. Its first model review said approved, but deterministic source/claim checks found unsupported claims and required the allowed correction; two successful provider-response checkpoints were saved. The correction did not produce an observable successful checkpoint in that window. Original Idea strategy_notes were restored in finally and independently re-read to verify exact equality. This is an incomplete live test, not a confirmed model/transport error and not a successful legacy-path acceptance. The hosted run was still RUNNING at last observation; do not submit a duplicate or assume no later completion. No production job was killed and no gate was weakened. Resume observation of this run ID before deciding on recovery.

V6 is deployed; V7 remains open. Required follow-up: inspect the legacy run's hosted execution/result; obtain the pending human Script/blueprint decisions; test blueprint-derived creation, selected storyboard and immediate independent audit dispatch, and a current authorized production export. Do not reuse the earlier manually dispatched audit as proof that the new automatic handoff is verified. Controlled destructive failures/weekly due schedules remain isolated-test proof only.
