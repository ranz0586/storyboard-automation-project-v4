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
