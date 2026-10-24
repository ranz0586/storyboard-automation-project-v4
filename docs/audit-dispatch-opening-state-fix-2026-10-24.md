# Audit dispatch and opening-state correction — 2026-10-24

Implemented in `D:\GitHub\storyboard-automation-project-v4`, based on pushed `b2551d5`. These fixes remain uncommitted and undeployed.

## Evidence and cause

The approved live test produced a usable source-faithful storyboard, but its audit intent remained unclaimed for over two minutes while maintenance heartbeats continued. Manually starting that same intent completed its audit. The code saved intent without directly dispatching it from the generating Workflow, depending on maintenance. A prior maintenance owner pinned to older code is an operational hypothesis; hosted logs have not established that exact cause.

The audit correctly blocked Scene 5: its image already showed the paperclip resting on the floor while its motion described descent and landing. Scenes 1/4 had analogous pre-liftoff/pre-contact contradictions. Approved structured initial/final states were correct, but image suggestions depicted completed actions. Existing guidance did not unambiguously settle that conflict.

## Narrow changes

- `processScriptStoryboard` now offers `onAuditPending` after durable intent and before Script completion. Cloud execution injects direct `productionWorkflow(['AUDIT', id])` dispatch. Dispatch failure keeps saved content and intent recoverable; it does not fail an otherwise usable storyboard or regenerate content.
- The current cron handler reconciles production queues directly, independent of the background maintenance owner. Existing database leases, actor fencing, shared slots, cooldowns and provider checkpoints remain authoritative.
- Shared `OPENING_FRAME_CONTRACT` reaches writing/review/conversion. Image A depicts the opening, video B starts there and performs the action. For conversion, approved `initial_state` overrides a contradictory image suggestion, and an explicit approved state map supplies initial/motion/final values by scene. Static scenes may have equal endpoints. Structure 2/3 contracts are preserved.
- Original agent system files and versioned guidance-pack bodies remain unchanged. No new schema, environment variable, dependencies, semantic approval bypass or agent round trip.

## Verification

Four new checks fail before the patch and pass after it. They cover dispatch despite an older maintenance owner, saved-content recovery after dispatch failure, cron dispatch independent of maintenance ownership, shared A/B instruction priorities and the approved opening-state map overriding contradictory suggestions without mutating Script data.

Full gates: 247 backend tests (test-file concurrency 1), 16 browser tests, Vercel build/routing/Workflow emission checks passed. Whitespace/syntax checks apply to changed files. Mocked proof is not hosted dispatch proof. Publishing and a post-deployment automatic handoff check remain pending.

## Existing live test package

Prepared a backed-up repair for Storyboard `recVoPB915go6Uenu` belonging to Script `recSLOTFqtbBQEzra` in dedicated `Science_Explainers`. The guarded live repair changes only image prompts in Scenes 1/4/5 to the approved opening states, in both canonical package and separate Structure 1 storage. Narration, duration, motion, Script status, brief and unrelated fields remain unchanged. A new live audit revision is being observed; its final result is recorded below. Original BLOCKED report remains evidence and is not edited.

Private backup, prepared diff and live outcome: `data/vercel-v345-opening-repair-20261024.json`. No new Script or storyboard generation. Future model output can still fail the independent semantic audit; these instructions do not guarantee a PASS.

## Release and rollback

No database migration is needed beyond the already applied V3–V5 schema. Deploy the compatible handlers/Workflows together, then verify direct automatic audit handoff on one bounded approved test. Current cron supplies the fallback; its configured daily cadence remains unchanged. Retain blocked/completed reports and content on rollback. Do not reset lifecycle status, cancel unrelated work or claim the local dispatch patch is already running in Production.

### Live repair result

The exact three-image correction was applied to the same live Storyboard under the shared database lease; source identity/package comparison prevented overwriting intervening edits. New audit revision dc452145-c11c-409e-b277-c7514e36c67e completed with no issues and prompt alignment 10/10. All deterministic checks passed; original blocked report 50a84164-bd24-4660-ba52-490c04916a29 is unchanged. Verdict is NEEDS_REVIEW, not PASS: the model left the applicable brand dimension unscored, so readiness correctly remains false. No verdict override or extra quota retry was used. No Script/storyboard regeneration or project-default changes occurred. This proves repair of the reported A/B issues; the new automatic dispatch code remains local and needs publication plus hosted handoff verification.
