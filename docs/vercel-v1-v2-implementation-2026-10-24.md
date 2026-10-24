# Vercel V1–V2 implementation — 2026-10-24

**Target:** D:\GitHub\storyboard-automation-project-v4
**Base revision:** 348fd9f6b157115820c7a23b012dc8f2e56b91f7
**Status:** Implemented in the local Vercel worktree; uncommitted and not deployed. V3–V7 remain outside this change.

Requested scope is [V1 and V2 of the Vercel roadmap](vercel-phased-implementation-plan-2026-10-23.md). The localhost checkout was read as a reference; it was not modified. Existing untracked comparison/baseline documents and graph output were preserved.

## V1: Script validation reliability

- Gemini malformed JSON now produces GEMINI_INVALID_JSON with model, finish reason and numeric position when the parser supplies one. Raw response text and parser excerpts are not copied into that error. The existing JSON-before-fences parser is retained.
- Primary/fallback and transient retry behavior remain unchanged. Invalid JSON can consume the remaining logical validation opportunity; at most two logical review calls are allowed. Underlying existing provider fallback/transient attempts remain separate from that ceiling.
- Each final scene identifies its original source_scene_number. Mixed original durations are accepted, split scenes retain the affected source duration, and all original sources must remain covered in order.
- Repair instructions use original durations plus candidate pause fields, not stretched durations from a rejected review. Under-length narration needs useful expansion; over-length narration needs shortening/splitting. Existing 150–180 WPM and full-voiceover/total-duration gates still apply.
- Timing-only final correction can use exact single-word slots. It still requires repaired visuals, fresh complete final scene reviews and a fresh hook/payoff/originality review. Its nested format is prompt-embedded JSON, not provider responseSchema.
- Explicit uncertainty is judged in the narration language and bound to an exact final-narration quote. No English keyword allowlist. Sensitive claims still require supplied factual support.
- Factual quotes normalize NFKC/spacing while retaining punctuation and numbers. The first scene must anchor the hook; comparison feedback identifies missing/unexpected/duplicate recent-record IDs.
- Script generation parse failures have a safe stage label. Invalid Idea counts fail at the shared agent boundary before calling Gemini.
- The cloud Script system's conflicting uniform-duration rules were changed only where necessary for the explicitly requested V1 behavior. Vercel's stronger substantive factual/editorial instructions were preserved. Other original agent system messages were not replaced.

Files: agents/scriptValidation runner/prompt/system, agents/script/system, utils/editorialReview, clients/gemini, agents/idea runner and scriptWorker. Shared mock review fixtures now return the new required fields.

## V2: source-faithful storyboard compatibility

The existing approvedScriptTimeline/checkTimes boundary now accepts either clock timestamp/time_range values or complete numeric start_seconds/end_seconds pairs against the same source. No second storyboard generator, new format, database table or normalization framework was added.

- Every supplied timing alias is checked; numeric values do not hide an invalid clock alias, or vice versa. A partial numeric pair is rejected.
- Timing uses the existing cloud 0.01-second tolerance. Frame point timestamps can use the approved source to establish their end; panels still need an explicit valid range.
- Source scene IDs/order, narration, per-format full runtime, panel membership, usable prompts and all selected formats remain mandatory. Selected-only persistence remains unchanged.
- Structure 1 accepts first_frame_prompt/panel_prompt only as unambiguous image aliases. Conflicting nonempty image aliases fail.
- Saved caches can use compatible separate legacy structure JSON columns, including a blank/missing summary or an ordinary legacy text summary. Malformed structured content/columns are not silently certified.
- Reads/validation work on copies. Existing raw stored packages are not mutated or bulk rewritten. Already completed Scripts retain their existing lifecycle behavior.
- Numeric cache reuse completes an interrupted status update without new Gemini work. A failed replacement does not overwrite the cached package or advance Script status.

Files: utils/storyboardValidation and targeted fixtures. The existing browser reader already displays numeric ranges and legacy prompt aliases; no UI redesign or API change was required.

## Preservation boundaries

src/cloud/context.js, controllers.js, workflows.js, coordination.js, state.js, schema.sql and src/vercel.js are unchanged. Database leases, cooldowns, slots, history/model checkpoints, server-only state and durable DEFERRED behavior remain authoritative. No file-backed runtime is introduced into cloud initialization.

The new cloud regression uses isolated PGlite and synthetic providers: malformed output saves no effect; a subsequent successful parse is checkpointed and reused by a fresh context; deferred attempts remain retryable. Existing lease/cooldown/lost-save/replay tests remain part of the passing full backend suite.

Manual approval, deterministic video IDs, owning Project resolution, one-concept-at-a-time generation and Airtable field mappings are unchanged. No new dependencies, schema migration, live provider call, Airtable/Telegram write, production schedule change or deployment was performed.

## Verification and completion audit

| Roadmap requirement | Evidence |
|---|---|
| JSON/fences retained; safe parse failure and bounded recovery | Existing json.test.js/gemini.test.js plus V1 parse/error/attempt cases in vercelPhases12.test.js |
| Original mixed durations, silence, split coverage, source identity/order | V1 mixed-source tests, original Script validation negatives and authoritative repair-budget regression |
| Fresh complete compact review, visual repair and two-call ceiling | Compact/stale/missing-review regression and existing failure-before-persistence tests |
| Multilingual uncertainty and unsupported sensitive/factual rejection | Tagalog quote/verdict negatives, existing editorialValidation.test.js, preserved stronger system rules |
| Hook/payoff/history and no silent acceptance | New schemas and existing complete editorial/source/history negative tests |
| Cloud checkpoints/deferral/global limits unchanged | cloud.test.js, including new malformed-JSON/deferral/checkpoint replay case |
| Both timeline representations/all seven selections | Cross-format V2 cases with fractional boundaries and no raw mutation |
| Contradictory IDs/times/narration/prompts, incomplete ranges | V2 alias negatives plus existing storyboardFidelity.test.js cases |
| Source totals/voiceover and failure before provider/save | Existing source precheck and invalid generated-package worker tests |
| Legacy columns/blank summaries and image aliases | Cache compatibility regression with raw-object equality |
| Cache lost-status recovery/no invalid replacement overwrite | Shared worker numeric-cache regression with provider/write/status counts |
| Existing dashboard/exports and scoped runtime unchanged | Mocked browser suite plus backend/source diff audit |

**Backend:** 220/220 tests passed.
**Browser:** 13/13 passed on the final application source..
**Vercel build/routing:** Passed React/Nitro build plus emitted routing, API fail-closed, Workflow trigger and cron checks..
**Syntax/diff:** checked affected modules; git diff --check passed.
**KOS:** Refreshed to 742 code nodes; separate status check returned current..

All external-service verification above is mocked/offline. No claim is made about deployed revision, Gemini availability/quota or live content success. V0's initially observed timing-sensitive test remains a known baseline limitation; it did not fail the final V1/V2 backend run.

Private/gitignored evidence: data/vercel-v12-implementation-evidence-20261024.json and retained logs under data/vercel-v12-logs-20261024/.

## Release and rollback

There are no schema changes to apply. Before publishing, attest the intended production revision/database and recheck active/queued jobs plus enabled schedules; V0 observed zero active jobs and three enabled schedules only at its timestamp.

Drain old generation jobs before switching the review/prompt contract, or separately prove a pinned old/new replay strategy. New prompts/schema affect checkpoint request hashes; resuming old runs blindly can repeat provider work. V1/V2 implementation does not claim that rollout gate is already satisfied.

Rollback source is 348fd9f with existing state/content/snapshots retained. The old browser reader already displays numeric ranges. Its old worker does not reuse numeric-only Approved caches, so drain in-flight/new numeric jobs before rolling back or validate a compatible rollback reader; do not bulk regenerate completed packages or delete successful content. Clock-form generation instructions remain the default.

No commit/push/deployment is included. V3 direct creation, blueprints, audits and held measured-media/channel analytics have not been implemented by this work.
