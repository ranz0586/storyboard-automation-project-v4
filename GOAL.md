# Development Goal

## Current status — reviewed 2026-10-03

The dashboard and execution foundations are implemented. The project is **not yet fully verified against this goal**. The original requirements below remain in scope; this status section and the checklist in section 27 record the evidence and remaining work.

### Recent verified changes

* Project statistics are working for the current live data. The user compared `Parenting_Facebook` with Airtable and confirmed 106 ideas, 62 scripts, 0 approved scripts, 39 storyboards, and 72 Draft/blank recovery candidates. These are a historical verification snapshot, not fixed acceptance values.
* Statistics use the custom project key, such as `Parenting_Facebook`, stored as a scalar in the current `Projects` data. Project retrieval still uses the Airtable record ID. The earlier statistics tests assumed linked-record arrays and were outdated for this read path.
* Updated `tests/airtable.test.js` and `tests/http.test.js` to reflect that statistics contract. Coverage now checks multiple pages, separate projects, missing/unrequested project values, projects with no records, no-project requests, page failures, and correct project-key mapping in the API.
* The current `npm.cmd run test:all` passed the complete backend suite, Vite production build, and all **4 Playwright browser tests** on 2026-10-03. External services were mocked. The two former statistics failures were resolved through corrected fixtures; the confirmed count logic was not changed.
* The dashboard now uses React in `client/`, with production assets built by Vite and served by Express. Browser coverage includes registration/login, project creation/switching, ideas, selected/count generation, ordinary failure retry, scheduling, script pagination/approval, mocked downstream execution, read errors, session expiry, mobile overflow, and the Vite cookie proxy. Runtime agents remain Node/Gemini.
* New scripts pass the Node-only Script Validation Agent and deterministic timing checks before persistence. Tests cover 150–180 WPM after pauses, narration/voiceover alignment, scene duration preservation, visual review, bounded correction, and refusal to persist rejected output through manual, scheduled, recovery, and operator paths. Live validation-agent quality and rendered audio/video timing remain unverified; existing usable scripts are reused without retroactive validation.
* Gemini models are loaded at backend startup. The current `.env` and a fresh process both select `gemini-3.8-flash` / `gemini-3.5-flash-lite`. Restart the backend after model edits; retries do not reload `.env`, and historical errors remain in old runs. This check did not verify provider model availability.
* Schedule edits now start with the first occurrence after the edit, including when a prior run exists or the schedule is re-enabled. Regression tests cover both cases.
* The dashboard can review paged scripts, approve a complete Draft for storyboard generation, and set a project's Active/Inactive status. Local mock-browser checks verified approval, inactive-state blocking of generation and recurrence, and switching to a project with no schedule. The live `Projects.status` field has Active/Inactive choices; both current projects have blank status, treated as Active. The user added Approved to the live `Scripts.status` choices, confirmed by a read-only schema check.
* Statistics and eligible-Draft-idea reads now use project-scoped Airtable formulas. A read-only live check matched the user-verified Parenting counts and returned only Parenting records for scoped reads. Storyboard polling now resolves the live scalar project key and normalizes imported field names.
* Live schema inspection confirmed Ideas and Scripts `Projects` are scalar single-select fields. Ideas `title` has a leading BOM; Scripts `video_id` and Storyboard `storyboard_id` now have plain names. Generation, recovery, storyboard, and Airtable write/query paths use the scalar key and translate those identity names at the client boundary.
* `failedRecoveryItems` currently means all ideas with Draft/blank status, including ideas never attempted. It is not an exact count of failed Gemini requests.
* The prior live local-output test completed query planning, yt-dlp research grounding, research, one idea, and one usable script using `gemini-3.5-flash-lite`. It retrieved 15 video records with no 429 responses. That harness spaced calls by 65 seconds and bypassed the production Gemini wrapper; it did not verify production throttling, Airtable writes, Telegram delivery, or the current primary model. Its artifacts are under the gitignored `data/live-pipeline-test/` directory.
* A new local-output run used the production Gemini wrapper and yt-dlp: 60 video metadata results, one saved idea, one usable script, and an idempotent script retry. The primary model returned transient 503s; the configured fallback completed the run. Results are in `data/live-local-result.json`. This did not write Airtable or deliver Telegram messages.
* Run history now persists in `data/runs.json`; active and unresolved interrupted runs survive pruning. Startup marks in-flight runs interrupted, and the scheduler requeues only the unfinished portion of an interrupted occurrence after restart. A replacement run records which interrupted run it recovered. Tests cover persistence, pruning, replay, and a restart in a separate Node process.
* Ideas now use an atomic composite Airtable upsert on title and scalar project key. Script generation takes a shared-filesystem lock in addition to the deterministic Airtable upsert. A two-process test of the real script worker observed one Gemini generation and one script write.
* The approved live end-to-end check created one dedicated project and idea, generated one script manually, replayed it through a scheduled run and scoped recovery, approved it, persisted one storyboard, and received a successful Telegram send response. A read-only follow-up verified one idea, one script, and one storyboard for the test project, with the idea at `Script Generated` and script at `Story Generated`. The scheduled and recovery runs reused the existing script; they did not generate fresh scripts. Results are in `data/live-check-state/verified.json`.
* A separately approved live check created two more Ideas in the dedicated project. Two concurrent Node processes upserted the scheduled Idea and received the same Airtable record ID. The scheduled path generated a fresh Script, and scoped recovery generated another. A final Airtable read found three unique Ideas and three unique Scripts in the project. Results are in `data/live-check-state/generation-paths.json`. Both paths used the configured Gemini fallback after transient primary-model 503 responses; no additional Telegram alert was sent.

### Hardening implemented and verified locally ? 2026-10-03

1. **Interrupted runs:** the dashboard resumes unfinished work before, during and between items, and links already-recovered runs to their replacement. Atomic retry creation prevents repeated replacements. Browser coverage and a real local server restart confirm successful items are not regenerated.
2. **Authentication throttling:** local session checks and account-scoped limits precede external Users reads, including /api/auth/me. Rejected requests make no Airtable authentication read; accepted requests still recheck access. Coverage includes revocation, spoofed forwarding headers, CSRF and failed lookups.
3. **Storyboard retries:** a shared worker locks video identity, refreshes Script status and reuses usable saved output after ambiguous writes/status failures. A separate gate rejects empty/promptless packages without tightening forgiving schemas or changing original n8n prompts. Two-process coverage observes one generation and one write.
4. **Same-host storage coordination:** fresh-read locked transactions preserve independent writers and live process ownership and coordinate scheduled occurrences. Recovery follows manually resumed replacement chains. Abandoned state locks fail closed and require stopped servers before explicit recovery. Cross-host storage, queues, sessions and key cooldowns need a separate coordination strategy.
5. **Pagination:** projects and eligible ideas have bounded next/previous pages. Browser coverage reaches the fifty-first project and idea and generates two selected ideas across pages. Selection is capped at 50.
6. **Activity:** storyboard/recovery successes, reuse and failures persist as project-owned activity. Unresolvable legacy project references remain logs/alerts because they cannot safely be exposed to an account.
7. **Verification:** full Gemini-client coverage includes primary/fallback, bounded 503 retry, 429 rotation and malformed responses. Live metadata lists both configured models; live primary 503s were handled by fallback. A real generated script and its bounded correction failed timing checks and saved nothing. A compliant control passed a real Gemini review, saved once locally and reused on replay; control generation was mocked. No 429 was observed in these scoped calls. This hardening verification made no live Airtable writes or Telegram sends.

The final suite result is in data/hardening-tests.log and includes backend tests, the production Vite build and six browser tests. Earlier four-browser-test evidence above is historical.

### Remaining verification and practical limits

- **Deployment is pending:** the user confirmed the application is running locally and is not deployed. A real local Express process was stopped/restarted and recovered only unfinished work. The isolated test advanced an abandoned script lock timestamp to simulate expiry; production retains its ten-minute lease. Restart drops process-local sessions and requires login.
- **Generated-script quality remains open:** the gate correctly rejected live complex output and correction. Reliable Gemini repair, visual quality and rendered TTS/video timing are not established by the compliant control.
- **Statistics cost remains high:** the synthetic benchmark used 1,000 owned projects, 1,000 ideas and 500 scripts per project, plus 200 runs with 50 large error items each. One 50-project statistics page read 75,000 rows in 750 mocked provider pages. Peak RSS was about 315 MB and sequential history p95 about 151 ms. Four simultaneous tabs across five waves produced about 509 ms request p95 and 432 ms event-loop p95 with a simulated 20 ms account-read delay. Network latency, quota and provider aggregate load were mocked. Forty accepted sequential/concurrent history polls still made forty account reads. This measures current cost rather than proving production scalability.
- **Multi-process limits:** same-host file coordination and concurrent worker generation are tested. Cross-host storage, globally coordinated queues/key cooldowns, shared sessions and deployed durable disk remain unverified. Active/unresolved history can exceed the normal retention target.
- **Broad final gates:** arbitrary Airtable schemas, live failure alerts and the final rendered production lifecycle need separate verification. Previous live successes above predate script validation.

Statistics correctness, scalar project-key mapping, schedule edit/re-enable behavior and React migration remain resolved. See [CODE_REVIEW.md](CODE_REVIEW.md) for current implementation evidence and limits.

## Project

**n8n Automation Project**

A memory-efficient Node.js replacement for the n8n workflow:

**“Video Script Generation Flow Agentic v4”**

---

# 1. Primary Objective

Enhance the existing Node.js application into a **dashboard-controlled content production system** while preserving its existing functionality, agent architecture, low-memory design, Airtable integration, and prompt behavior.

The existing repository is the starting point.

**DO NOT rebuild the application from scratch.**

**DO NOT replace working components merely for architectural preference.**

**DO NOT rewrite the existing pipelines unnecessarily.**

The goal is to progressively improve the existing implementation until every requirement in this document is satisfied and verified.

---

# 2. Target Product

The final application should allow a user to manage the content-production lifecycle from a web dashboard:

```text
Content Projects
       │
       ▼
     Ideas
       │
       ▼
    Scripts
       │
       ▼
 Human Approval
       │
       ▼
  Storyboards
```

The dashboard becomes the primary control interface.

The existing agents and pipelines remain the execution layer.

---

# 3. Existing Functionality

The application currently supports:

1. Accepting niche and audience details through `POST /niche` and the existing web form.
2. Saving projects in Airtable.
3. Optional YouTube metadata research using `yt-dlp`.
4. Gemini-based research and content idea generation.
5. Individual script generation to minimize memory usage.
6. Telegram completion/error notifications.
7. Processing approved scripts into production-ready storyboards.
8. Recovery of ideas whose script generation previously failed.

Existing commands include:

```text
npm start
npm run pipeline
npm run storyboard
npm run recover-ideas
npm test
```

All existing functionality should remain operational unless a deliberate change is required by this goal.

Current deliberate changes: authenticated project and run APIs replace the implicit-project `/niche` endpoint, which returns `410`. The old web form has been replaced by the React dashboard at the user's request; the operator CLI pipelines remain available.

---

# 4. Technology

Preserve the existing technology stack unless there is a concrete reason to change it.

Current stack:

* Node.js 20.19+ or 22.12+ (see `package.json` engines)
* ES modules
* Express
* React dashboard with Vite builds; backend agents remain plain Node ESM
* Google Gemini
* Airtable
* Telegram Bot API
* Zod
* Optional `yt-dlp`

Do not introduce unnecessary frameworks or dependencies.

---

# 5. Existing Agent Architecture

Preserve the existing separation of responsibilities:

* Research Agent
* Idea Agent
* Script Agent
* Storyboard Agent
* Trend Scout

Where applicable, each agent should retain separation between:

* system instructions
* prompt construction
* model execution
* validation
* transformation
* persistence

Do not merge agents simply to reduce file count or simplify the implementation.

Do not change existing agent prompts unless required by a specific acceptance criterion.

---

# 6. Core Architectural Principle

The dashboard is the **control plane**.

The existing agents and pipeline implementations are the **execution layer**.

The dashboard must not duplicate business logic already implemented in the agents/pipelines.

Preferred architecture:

```text
                     DASHBOARD
                         │
                         ▼
                  API / Controllers
                         │
                         ▼
                  Pipeline Controller
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Research    Scripts   Storyboards
              │          │          │
              └──────────┼──────────┘
                         ▼
                      Airtable
```

Manual and scheduled execution must use the same pipeline implementation.

---

# 7. Content Project Management

The dashboard must introduce explicit content-project management.

## Required capabilities

Users must be able to:

* View content projects.
* Create a new content project.
* Open an existing project.
* View project configuration.
* View project pipeline statistics.
* Manage project status where appropriate.

Creating a project should explicitly create the project record.

The application should no longer depend on the old implicit workflow:

```text
receive niche
→ check whether project exists
→ decide whether to create
```

as the primary project-management experience.

Instead:

```text
Dashboard
→ New Project
→ Project configuration
→ Create Project
→ Project exists
→ Generate ideas/scripts/etc.
```

---

# 8. Project Dashboard

The dashboard should provide an overview of content projects.

At minimum, a project should expose useful pipeline counts such as:

* Ideas
* Scripts
* Approved Scripts
* Storyboards
* Failed/Recovery Items

Example conceptual structure:

```text
CONTENT PROJECTS

Parenting Tips
42 Ideas
18 Scripts
7 Approved
3 Storyboards

AI Science
31 Ideas
12 Scripts
4 Approved
2 Storyboards
```

The exact visual design is implementation-dependent.

Do not sacrifice functionality for visual complexity.

---

# 9. Project Creation

The dashboard should provide a New Project workflow.

The project configuration should use the existing project fields wherever possible.

Potential project properties include:

* Project name
* Niche
* Target audience
* Platform
* Content style
* Project status
* Other existing project configuration required by the current pipeline

Before adding new Airtable fields, inspect the existing schema.

**Reuse existing fields whenever practical.**

Only add fields when necessary to support the target functionality.

---

# 10. Script Pipeline Control

The dashboard must allow users to manually trigger script generation.

Users must be able to choose between:

### Generate by count

Example:

```text
Generate:
[ 10 ] scripts

[ Generate Now ]
```

### Generate selected ideas

Example:

```text
☑ Idea 102
☑ Idea 104
☑ Idea 109

[ Generate Selected ]
```

The exact UI is flexible.

The underlying behavior is not.

---

# 11. Individual Script Processing

The low-memory requirement is a core architectural constraint.

If the user selects 10 scripts, the system must NOT generate all 10 scripts simultaneously.

The preferred processing model is:

```text
Idea 1
→ Gemini
→ Validate
→ Save
→ Release resources

Idea 2
→ Gemini
→ Validate
→ Save
→ Release resources

...

Idea 10
→ Gemini
→ Validate
→ Save
→ Release resources
```

The system must avoid unnecessarily accumulating:

* all ideas
* all Gemini responses
* all scripts
* large Airtable datasets
* duplicate large objects

in memory.

Selecting 10 scripts means **10 sequential processing operations**, not a batch Gemini generation request.

This requirement must remain true for:

* manual runs
* scheduled runs
* recovery runs

---

# 12. Pipeline Run / Job System

Manual and scheduled pipeline execution should create a pipeline run.

A run should have a unique identifier.

Conceptually:

```text
POST /script-runs
        │
        ▼
      run_id
        │
        ▼
      QUEUED
        │
        ▼
     RUNNING
        │
        ▼
   3 / 10 complete
        │
        ▼
   10 / 10 complete
        │
        ▼
    COMPLETED
```

The dashboard should be able to display the run state.

Possible run statuses:

```text
QUEUED
RUNNING
COMPLETED
PARTIAL
FAILED
CANCELLED
```

A run should track, where practical:

* run ID
* project
* requested count
* selected ideas
* status
* start time
* completion time
* successful count
* failed count
* current item
* error information

The exact persistence mechanism should be determined after inspecting the existing architecture.

Do not create a new database solely because a simpler existing persistence mechanism can satisfy the requirement.

---

# 13. HTTP Behavior for Pipeline Runs

Do not make a long-running Gemini/Airtable pipeline depend on a browser request remaining open.

Preferred behavior:

```text
Browser
   │
   │ POST /script-runs
   ▼
Server
   │
   ├── validate
   ├── create run
   └── return run ID
             │
             ▼
          Worker
             │
             ▼
       Process sequentially
```

The API should return promptly after successfully accepting a valid run.

The dashboard can then query the run status.

---

# 14. Weekly Script Scheduling

The dashboard must allow a project to have an optional recurring script-generation schedule.

Initial scheduling requirements:

* Enable/disable schedule.
* Weekly frequency.
* Day of week.
* Time.
* Number of scripts per run.

Example:

```text
Project:
Parenting Tips

Schedule:
Enabled

Frequency:
Weekly

Day:
Monday

Time:
09:00

Scripts per run:
10
```

The exact scheduling implementation should fit the existing application architecture.

Do not introduce a second independent script-generation system.

---

# 15. Scheduler Architecture

The scheduler should NOT directly implement script generation.

Instead:

```text
Weekly Scheduler
       │
       ▼
Create Pipeline Run
       │
       ▼
Existing Pipeline Controller
       │
       ▼
Script Worker
       │
       ▼
Sequential Script Generation
```

Manual execution should follow the same path:

```text
Dashboard
   │
   ▼
Create Pipeline Run
   │
   ▼
Existing Pipeline Controller
   │
   ▼
Script Worker
```

Therefore:

```text
Manual Run ───────┐
                  ├──► Pipeline Controller
Weekly Schedule ──┘
```

There must be only one authoritative script-generation implementation.

---

# 16. Existing Known Reliability Issues

Before or while adding dashboard functionality, address the existing known issues.

## Priority 1 — Structure 3

Fix missing `structure3` handling in storyboard transforms.

The canonical Structure 3 data must survive the storyboard pipeline without being lost, omitted, renamed incorrectly, or transformed incorrectly.

Do not invent a new storyboard schema.

Inspect the actual existing implementation and identify where `structure3` is lost.

Add regression tests.

---

## Priority 2 — Empty Gemini Results

Prevent empty or invalid Gemini responses from creating blank scripts.

Invalid results include:

* empty response
* missing required fields
* malformed structured response
* unusable script content

Invalid output must not be persisted as a valid script.

Use existing Zod validation where practical.

Add regression tests.

---

## Priority 3 — Idempotent Script Persistence

Script persistence must be idempotent.

Repeated execution must not create duplicate scripts.

The implementation must safely distinguish between:

```text
No script exists
→ create

Valid script exists
→ do not duplicate

Incomplete/failed script exists
→ recover/update safely

Ambiguous persistence failure
→ retry without creating duplicates
```

Inspect the existing Airtable identifiers and persistence logic before implementing.

---

## Priority 4 — Idempotent Recovery

`npm run recover-ideas` must be safe to run repeatedly.

It must not create:

* duplicate scripts
* duplicate processing
* inconsistent state

It must safely handle:

* previously failed generation
* partially persisted records
* already recovered ideas
* transient Airtable failures
* transient Gemini failures

---

## Priority 5 — Request Validation

Validate HTTP requests before returning `202`.

For `POST /niche`:

1. Validate the request body.
2. Reject malformed requests.
3. Return an appropriate 4xx response.
4. Only return `202` after valid input has been accepted for processing.

Use Zod.

---

## Priority 6 — Authentication

Protect externally accessible pipeline endpoints.

Authentication must:

* fail closed when credentials are missing or invalid
* never expose secrets
* use environment variables/configuration
* avoid hardcoded credentials

Add tests for:

* valid authentication
* missing authentication
* invalid authentication

---

## Priority 7 — Throttling

Add rate limiting/throttling to prevent uncontrolled expensive operations.

Protect:

* Gemini
* Airtable
* pipeline execution

Do not add excessive dependencies without justification.

---

## Priority 8 — Concurrency Controls

Prevent uncontrolled simultaneous pipeline execution.

The system must not accidentally launch multiple expensive operations that violate the low-memory design.

Determine the correct level of concurrency control from the existing architecture.

Possible levels include:

* request
* project
* pipeline
* script

Prefer the smallest appropriate locking/control scope.

---

# 17. Dashboard Activity

The dashboard should provide visibility into recent pipeline activity.

Useful events include:

* script generated
* script failed
* pipeline started
* pipeline completed
* pipeline partially completed
* storyboard generated
* recovery completed
* scheduled run started

The dashboard should not require the user to inspect Airtable directly to determine whether a pipeline is running.

---

# 18. Error Handling

Errors must be represented explicitly.

Do not silently convert failures into successful states.

A failed individual script should not necessarily cause all other eligible scripts to stop.

Where safe:

```text
10 requested
8 successful
2 failed

Run status:
PARTIAL
```

The run should preserve enough information to retry failed items safely.

---

# 19. Existing Commands

Preserve existing commands unless a deliberate migration is required:

```text
npm start
npm run pipeline
npm run storyboard
npm run recover-ideas
npm test
```

The dashboard should eventually become the primary user-facing interface, but existing commands should continue to work where practical.

---

# 20. Testing Requirements

The original baseline had 10 tests. The 2026-10-03 review ran the complete current backend suite, Vite build and four browser tests successfully with `npm.cmd run test:all`. This does not imply every coverage requirement below is implemented; outstanding coverage is listed in the current-status section and CODE_REVIEW.md.

All existing tests must continue to pass unless a test is demonstrably obsolete because the intended behavior has changed.

Expand testing to cover:

## Project Management

* project creation
* project retrieval
* project configuration
* duplicate project handling where relevant

## HTTP

* valid `/niche`
* invalid `/niche`
* missing required fields
* authentication failure
* throttling

## Gemini

* valid response
* empty response
* malformed response
* validation failure
* transient failure

## Airtable

* successful persistence
* duplicate prevention
* retry after failure
* partial persistence
* existing record
* API failure

## Script Pipeline

* single script
* multiple sequential scripts
* selected ideas
* requested script count
* empty Gemini result
* persistence failure
* retry
* duplicate execution
* recovery

## Pipeline Runs

* run creation
* queued state
* running state
* completion
* partial completion
* failure
* status retrieval

## Scheduling

* schedule creation
* schedule update
* schedule enable/disable
* weekly execution
* correct script count
* scheduled run uses the same pipeline controller as manual execution

## Storyboard

* approved script processing
* `structure3` preservation
* malformed storyboard data
* transformation failure

## Concurrency

* duplicate pipeline requests
* concurrent script generation
* simultaneous recovery
* conflicting runs

Tests should primarily verify behavior, not implementation details.

---

# 21. Memory Requirements

Low memory usage is a fundamental project requirement.

Codex must actively consider memory impact when modifying:

* script generation
* idea processing
* recovery
* pipeline runs
* dashboard requests
* Airtable queries
* Gemini responses
* scheduler execution

Avoid:

```text
fetch everything
→ store everything
→ process everything
```

Prefer:

```text
fetch one
→ process one
→ persist one
→ release
→ next
```

The dashboard must not require loading an entire project's scripts or ideas into memory merely to display counts or paginated records.

Use pagination/limited queries where appropriate.

---

# 22. Airtable Constraints

Before modifying Airtable:

1. Inspect the existing schema.
2. Understand existing relationships.
3. Reuse existing fields where practical.
4. Determine whether the required functionality can be implemented
   without schema changes.

Do not create unnecessary tables.

Do not migrate existing data without a clear requirement.

If new fields are genuinely necessary, keep the schema as simple as possible.

---

# 23. UI Requirements

The dashboard should prioritize usability over visual complexity.

The user should be able to quickly:

1. See projects.
2. Create a project.
3. Open a project.
4. See idea/script/storyboard counts.
5. Trigger script generation.
6. Select how many scripts to generate.
7. Select specific ideas.
8. See running pipeline progress.
9. Configure weekly generation.
10. See failures and retry them.

The UI should not duplicate backend business logic.

---

# 24. Development Strategy

Implement incrementally.

Recommended implementation order:

### Phase 1 — Repository understanding

* inspect existing architecture
* inspect Airtable schema
* inspect current pipelines
* inspect tests
* identify actual data flow

### Phase 2 — Reliability foundation

* `structure3`
* empty Gemini handling
* idempotent persistence
* idempotent recovery
* request validation
* authentication
* throttling
* concurrency

### Phase 3 — Project API

* project creation
* project retrieval
* project status
* project statistics

### Phase 4 — Dashboard foundation

* dashboard shell
* project list
* project creation
* project detail

### Phase 5 — Pipeline run system

* run model
* run controller
* run status
* sequential worker
* progress tracking

### Phase 6 — Manual script generation

* generate by count
* generate selected ideas
* progress
* failures
* retry

### Phase 7 — Scheduling

* weekly schedule
* enable/disable
* day/time
* scripts per run
* scheduler → pipeline controller

### Phase 8 — Final hardening

* integration testing
* concurrency testing
* Airtable failure testing
* Gemini failure testing
* memory review
* security review
* final UI review

This order is a guideline, not a rigid requirement. Codex should reassess the actual repository before deciding the next implementation step.

---

# 25. Autonomous Codex Development Loop

Codex must operate using the following loop.

## Step 1 — Inspect

Inspect the current repository before making assumptions.

Review:

* source code
* package configuration
* tests
* APIs
* Airtable integration
* agents
* pipeline logic
* existing UI
* scheduler
* current git state

---

## Step 2 — Assess

Compare the actual repository against this `GOAL.md`.

Determine:

* completed requirements
* partially completed requirements
* incomplete requirements
* regressions
* missing tests

Do not rely solely on previous agent output.

Verify against the actual source code.

---

## Step 3 — Select Next Objective

Select the highest-priority incomplete requirement that can safely be addressed next.

Prefer foundational work that enables later requirements.

Do not perform unrelated improvements.

---

## Step 4 — Plan

Before modifying code:

* identify relevant files
* understand current implementation
* trace data flow
* identify required changes
* identify tests needed
* identify compatibility risks

---

## Step 5 — Implement

Implement the smallest safe change.

Preserve existing functionality.

Do not rewrite working components without a concrete reason.

---

## Step 6 — Test

After each meaningful implementation:

* run relevant tests
* run regression tests
* run syntax checks
* run build/type checks when available

---

## Step 7 — Fix

If tests fail:

1. inspect failure
2. identify root cause
3. fix
4. rerun

Do not continue to unrelated requirements while the current implementation is broken.

---

## Step 8 — Verify

Confirm the requirement itself is satisfied.

Passing tests alone is not sufficient if the requirement is not actually covered.

---

## Step 9 — Reassess

Re-read this `GOAL.md`.

Inspect the repository again.

Determine what remains incomplete.

---

## Step 10 — Continue

If requirements remain:

```text
ASSESS
→ SELECT
→ PLAN
→ IMPLEMENT
→ TEST
→ FIX
→ VERIFY
→ REASSESS
→ repeat
```

Continue until the Definition of Done is satisfied.

---

# 26. Anti-Patterns

Codex must avoid the following:

### Do not rebuild the application

Do not replace the existing application with a new architecture merely because it may appear cleaner.

### Do not create duplicate pipelines

Manual and scheduled script generation must use the same pipeline controller.

### Do not duplicate business logic in the dashboard

The UI should call backend APIs.

### Do not batch scripts into memory

Processing 10 scripts means sequentially processing 10 items.

### Do not silently swallow failures

Failures must be represented and recoverable.

### Do not create duplicate Airtable records on retry

Persistence must be idempotent.

### Do not change prompts unnecessarily

Existing agent prompts are part of the current system behavior.

### Do not add unnecessary dependencies

Use the existing stack whenever practical.

### Do not perform unrelated refactoring

Only refactor when it materially supports the target goal, correctness,
security, maintainability, or testing.

### Do not claim completion prematurely

All acceptance criteria must be verified.

---

# 27. Definition of Done

The project is complete only when all applicable criteria below are satisfied.

Checklist convention: `[x]` means verified by current source and the applicable local tests, or by explicitly identified user/live evidence above. It does not imply live end-to-end verification. Unchecked items are incomplete or only partially verified; the original acceptance criteria are preserved. UI implementation checks remain subject to the browser review and final integration gate.

## Existing Reliability

* [x] `structure3` is correctly preserved through storyboard transformations.
* [x] Empty Gemini results cannot create blank scripts.
* [x] Script persistence is idempotent.
* [x] Recovery is idempotent.
* [x] Pipeline requests validate before acceptance; `/niche` is deliberately retired with `410`, and authenticated project/run APIs replace it.
* [x] Authentication protects exposed pipeline endpoints.
* [ ] Throttling is implemented.
* [ ] Concurrency is controlled.

## Project Management

* [x] Dashboard exists.
* [x] Projects can be listed.
* [x] Projects can be created explicitly.
* [x] Projects can be opened.
* [x] Project information is displayed.
* [x] Pipeline counts are displayed.
* [x] Project creation no longer depends on the old implicit existence-check workflow.

## Script Generation

* [x] Scripts can be generated manually.
* [x] User can specify the number of scripts.
* [x] User can select individual ideas.
* [x] Selected ideas can be processed.
* [x] Scripts are processed sequentially.
* [x] Progress is visible.
* [x] Failures are visible.
* [x] Failed items can be safely retried (local lifecycle, interruption and idempotent replay coverage).
* [ ] Duplicate generation is prevented.

## Pipeline Runs

* [x] Manual generation creates a pipeline run.
* [x] Runs have unique IDs.
* [x] Runs expose status.
* [x] Runs track progress.
* [x] Successful and failed items are tracked.
* [x] Partial completion is supported.
* [x] Dashboard can display run state.

## Scheduling

* [x] Weekly schedules can be configured.
* [x] Schedules can be enabled/disabled.
* [x] Day can be configured.
* [x] Time can be configured.
* [x] Script count can be configured.
* [x] Scheduled execution creates a pipeline run.
* [x] Scheduled execution uses the same pipeline controller as manual execution.

## Memory

* [x] Script processing remains sequential.
* [ ] Large unnecessary collections are not accumulated.
* [ ] Dashboard requests do not unnecessarily load entire projects.
* [x] Recovery remains memory efficient.

## Testing

* [x] Existing tests pass.
* [x] New reliability tests pass.
* [x] Pipeline tests pass.
* [x] Storyboard tests pass.
* [x] Airtable failure tests pass.
* [x] Gemini failure tests pass (full primary/fallback/503/429/key-rotation and malformed-response coverage).
* [x] Project API tests pass.
* [x] Pipeline-run tests pass.
* [x] Scheduling tests pass.
* [x] Concurrency tests pass.

Verification boundaries: checked test items refer to current coverage, not every case in section 20. Scalar project-key mapping is reconciled in generation/recovery/storyboard paths. Script persistence and recovery use deterministic IDs, atomic upserts and shared per-idea locking; existing-script reuse, ambiguous Script writes and concurrent workers have passing tests. Retry and duplicate-prevention boxes remain open for interrupted dashboard runs and broader storyboard/run/scheduler coordination. HTTP limiters and a bounded process-local queue exist, but authentication reads precede those limiters and provider/deployment-wide throttling is incomplete. Gemini output validation and bounded 503 retries pass; the full client fallback/key-rotation matrix is not covered. Schedule edits/re-enabling and local restart replay pass; deployed behavior remains unverified. React browser coverage and script validation are local/mocked evidence, not proof of live output quality or production readiness.

---

# 28. Final Verification

Before declaring the project complete:

1. Run the complete test suite.
2. Run syntax validation.
3. Run build/type checks if available.
4. Inspect the final code changes.
5. Verify every Definition of Done criterion.
6. Review the low-memory architecture.
7. Review authentication and throttling.
8. Review Airtable failure behavior.
9. Review Gemini failure behavior.
10. Review idempotency.
11. Review manual script generation.
12. Review scheduled script generation.
13. Verify both execution paths use the same pipeline controller.
14. Verify the dashboard does not duplicate pipeline business logic.

Do not declare completion if any critical criterion remains unverified.

---

# 29. Final Report

When the goal is complete, provide:

1. Summary of implemented functionality.
2. Requirements completed.
3. Files changed.
4. Tests added or modified.
5. Verification performed.
6. Any remaining limitations.
7. Any recommendations that are explicitly outside this goal.

Do not make unrelated improvements simply because they are possible.

---

# 30. Git / Publishing Rules

Codex may inspect the git repository and its current state.

However:

* Do not commit unless explicitly instructed.
* Do not push unless explicitly instructed.
* Do not create a pull request unless explicitly instructed.
* Do not modify unrelated working-tree changes.
* Do not discard user changes.

The repository's existing work is authoritative.

Deployment acceptance steps and required evidence are preserved in [DEPLOYMENT_VERIFICATION.md](DEPLOYMENT_VERIFICATION.md).
