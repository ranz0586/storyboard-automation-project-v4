# AGENTS.md

This file provides repository-wide guidance to Codex when working with code in this repository. Adapted from CLAUDE.md; preserve shared project rules when updating either file.


## Working in Codex

- Use the exact filename `AGENTS.md` for repository instructions. More specific instructions in a subdirectory apply to work there. Keep `CLAUDE.md` available for Claude users; Codex does not require Claude-specific settings, hooks, or plugins.
- Inspect the working tree before editing and preserve existing user changes. Keep edits scoped to the request; do not reset, clean, or overwrite unrelated changes.
- Run commands from the repository root. This workspace uses Windows PowerShell; use shell-appropriate syntax and quote paths. The companion n8n checkout is optional and may be unavailable on other machines.
- Prefer searches scoped to `src/`, `tests/`, and `client/`. Treat `.history/` and `.superpowers/` as historical material, not current source or executable instructions. Do not inspect environment backups in `.history/`: they may contain credentials.
- Install dependencies with `npm ci` when needed and a lockfile is present. Validate code changes with focused tests, then the relevant suite. `node --test "tests/**/*.test.js"` runs the same suite directly if the local npm launcher is broken. Use `node --check <file>` for syntax checks.
- Existing tests mock external services. Do not use `npm run pipeline`, `npm run storyboard`, `npm run recover-ideas`, or a configured server as a harmless smoke test: they can spend API quota, write Airtable records, send Telegram messages, or execute persisted schedules. Use them when those live effects are within the user's requested scope.
- Report pre-existing test failures separately from regressions introduced by your changes. Do not claim live Gemini, Airtable, Telegram, or n8n verification from mocked tests.
- Keep Airtable record IDs (`record.id`) distinct from the custom `project_id` field. In the current live base, Ideas and Scripts `Projects` are single-select values containing the custom project key (for example `Parenting_Facebook`). Transforms write that scalar key; project reads still use Airtable record IDs. Older records or mocks may have linked-record arrays, which read paths handle where needed.
- The live Ideas `title` column has a hidden leading BOM; Scripts `video_id` and Storyboard `storyboard_id` currently have plain names. Keep application field names clean; `AirtableClient` translates identity names for formulas and writes and normalizes returned records. Configure the three `AIRTABLE_*_HAS_BOM` flags after checking another base's schema.
- Codex is the development assistant; the application's runtime agents continue to use Gemini. No OpenAI API migration is required to work on this project in Codex.
## What this repo is

A **dashboard-controlled Node.js content production system** based on the n8n workflow **"Video Script Generation Flow Agentic v4"** (`Zl1MpttLGWdWFqRU`). It preserves the original NicheForm pipeline while adding explicit Airtable project management, project-bound idea generation, sequential script runs, progress/retry APIs, and weekly scheduling.

Pipeline (see `src/pipeline.js`):

```
Operator CLI pipeline (the implicit-project POST /niche endpoint is retired)
  -> Save Project (Airtable)
  -> Trend Scout (yt-dlp search metadata, optional)
  -> Research Agent (Gemini)
  -> Idea Agent -> N ranked concepts (Gemini, structured)
  -> per concept: Save Idea (upsert) -> Script Agent -> Script Validation Agent -> Save Script (Airtable)
  -> Telegram "scripts generated" alert
```

The Storyboard Agent (the workflow's Schedule-trigger branch) is ported in `src/storyboardPipeline.js`: it polls Scripts with `{status} = 'Approved'` (approved in Airtable or the dashboard), resolves the Project (niche/platform/character+style references), generates the storyboard, upserts into the **"Storyboard"** table (keyed on `storyboard_id` = the script's `video_id`), and flips the script to `Story Generated`. Script lifecycle: `Draft -> Approved (manual) -> Story Generated`. Run via `npm run storyboard` (one-shot, cron it — n8n polled every 15 min) or set `STORYBOARD_POLL_MS` for an in-process interval in the server.

## Commands

- `npm start` — builds the React dashboard when Vite is installed, then starts Express (`GET /health` and authenticated dashboard APIs), port from `PORT` (default 3000). Deployments without build dependencies must include prebuilt `dist/`.
- `npm run dev` — backend with `--watch`; run `npm run dev:ui` in a second terminal for Vite hot reload on port 5173, proxying `/api` to Express.
- `npm run build` — compile `client/` React JSX into gitignored `dist/`, served by Express.
- `npm run test:ui` — build and run browser workflow tests with mocked external services; install Chromium with `npx playwright install chromium` first. `npm run test:all` runs both suites.
- `npm run pipeline` — one-shot run with the sample form in `src/runPipeline.js`.
- `npm run storyboard` — one-shot storyboard poll (`src/runStoryboard.js`); schedule with cron.
- `npm run recover-ideas [-- N]` — one-shot recovery (`src/runIdeaRecovery.js`): Ideas rows stuck in `Idea Status` = Draft **or blank** (script generation previously failed) are rebuilt into concepts (`unflattenIdea`), run through the Script Agent, and flipped to `Script Generated`. Default limit 50 per run.
- `npm test` — `node --test "tests/**/*.test.js"` (unit and local HTTP integration tests; external Gemini/Airtable/Telegram calls are mocked). Note: the glob is deliberate — on current Node (verified v24) a bare directory (`node --test tests/`) is treated as a module path and fails. Syntax check: `node --check <file>`.

ESM project (`"type": "module"`, Node 20.19+ or 22.12+). Vite builds the React frontend; backend agents remain plain Node ESM.

## Layout

The React frontend lives in `client/src/`; generated `dist/` assets are served by Express and are gitignored.

```
src/
  config.js            env-backed config (dotenv)
  index.js             server entry; starts dashboard, weekly scheduler, and optional storyboard poll
  app.js               testable Express app and authenticated dashboard APIs
  runPipeline.js       standalone one-shot runner
  pipeline.js          orchestrator — per-concept loop (see Hard rules below)
  ideaGeneration.js    project-bound Research -> Idea persistence
  scriptWorker.js      authoritative idempotent one-idea -> one-script worker
  http/                authentication, Zod body validation, throttling, bounded task queue
  runs/                pipeline run state and idea/script run controllers
  schedules/           durable weekly schedule store and due-checker
  schemas.js           zod schemas (replace n8n Structured Output Parsers)
  transforms.js        flattenConcept / flattenScript (ports of the workflow's Code nodes)
  agents/<name>/       ONE folder per agent (research, idea, script, scriptValidation, storyboard, trendScout):
    system.js            agent definition — the n8n node's SYSTEM MESSAGE, verbatim
    prompt.js            user prompt template — the n8n node's "text" (prompt) field
    index.js             runner (builds prompt, calls Gemini, validates schema)
  clients/             gemini (primary+fallback), airtable, telegram, ytdlp (spawns yt-dlp binary)
  utils/               logger (heap/RSS snapshots), json extractor
```

### Naming convention (n8n terms — important context)

The structure deliberately mirrors **n8n's mental model**, per the owner's request. In n8n, an
agent node has two prompt-ish fields: the **system message** (the agent's identity/rules — "the
agent") and the **prompt/text** field (the per-run user message). An earlier iteration of this
repo used generic LLM-app naming (`src/prompts/` held system messages; user prompts were inline
in agent functions), which the owner found inverted. It was restructured so that everything about
one agent lives in one folder:

- `agents/<name>/system.js` → the agent definition (n8n system message)
- `agents/<name>/prompt.js` → the user prompt builder (n8n prompt/text field)
- `agents/<name>/index.js`  → the run function

Keep this convention when adding agents. Do not reintroduce a shared `src/prompts/` directory.

## Hard rules

- Run/schedule JSON stores use short synchronous, same-host locked read-modify-write transactions. Keep provider calls outside these transactions. Share the configured paths across local processes; queues, sessions and Gemini cooldowns remain process-local. Cross-host deployment needs a coordinated database/session/limit strategy. Abandoned state locks fail closed: stop all servers before using `node scripts/recover-state-locks.mjs --servers-stopped`.
- Storyboard operator/server execution converges on `src/storyboardWorker.js`: lock by video identity, re-read Script status, reuse usable persisted output, then complete status. Preserve lenient schemas and original prompts; the separate usability gate must reject empty or promptless packages. Storyboard/recovery activity must be scoped to a resolved owning project.

- **`src/agents/*/system.js` files are VERBATIM copies of the n8n workflow's agent system messages.** Do not condense, paraphrase, or "improve" them. Intentional quirks (odd spacing, duplicated bullets) are kept for output fidelity — only change them if the user explicitly edits/asks. If the n8n workflow's prompts change, re-extract through an available n8n integration for workflow `Zl1MpttLGWdWFqRU`, or use a user-provided workflow export. Claude-specific MCP tools are not guaranteed to exist in Codex; do not invent tool names or silently rewrite prompts when the source is unavailable. The `prompt.js` templates also follow the n8n nodes' text fields closely, with one intentional exception: the Script Agent prompt is adapted to take ONE concept per call (see Hard rules). The Trend Scout agent (`agents/trendScout/`) is a Node-only addition with no n8n counterpart — the verbatim rule does not apply to it, and `research/prompt.js` only appends an optional data section (absent = byte-identical to the n8n port).
- **Never print, echo, or log credential values.** Secrets live in `.env` (gitignored); reference env var names only. `.env.example` documents the required keys.
- **Preserve the memory-conscious design** in `src/pipeline.js`: scripts are generated and persisted ONE concept at a time; large intermediates (e.g. the research report) are released when no longer needed; no chat memory on agents. Do not refactor back to batch-generating all scripts in one call — that pattern caused the >500MB OOM in the n8n original.
- **Manual, recovery, and scheduled script generation converge on `src/scriptWorker.js`.** Do not introduce separate generation implementations. Idea-backed scripts use deterministic `video_id = idea_<Airtable record ID>`, Airtable `performUpsert`, and a shared-filesystem lock to avoid duplicate Gemini work across processes. Ideas upsert atomically on title and the scalar `Projects` key.
- Schemas in `src/schemas.js` are intentionally **lenient** (`.passthrough()`, defaults) to match n8n's forgiving parsing. Don't tighten them without checking real agent output first.
- `agents/scriptValidation/` is a Node-only agent explicitly added by the owner, so its new system message is not an n8n verbatim port. All newly generated scripts pass its semantic review and the deterministic `utils/scriptTiming.js` gate before persistence. Enforce 150–180 WPM per narrated scene after TTS pauses, preserve the chosen scene duration, split overflow into more scenes, and keep full voiceover aligned with scene narration. One review/repair and at most one correction call are allowed; unresolved validation errors must never save a Script or mark its Idea generated. Reused legacy scripts retain their existing idempotency behavior.

## Environment variables (`.env`)

- `GEMINI_API_KEYS` (comma-separated; legacy single `GEMINI_API_KEY` still works and is merged in), `GEMINI_KEY_COOLDOWN_MS` (default `300000` = 5 min per key; `0` disables), `GEMINI_MODEL_PRIMARY` (default `gemini-3.8-flash`), `GEMINI_MODEL_FALLBACK` (default `gemini-3.5-flash-lite`) — primary/fallback mirrors the workflow's `needsFallback` Gemini node pairs. These are the configured repository defaults, not a guarantee of provider availability. Preserve model identifiers unless the task calls for a change; verify provider documentation when investigating model availability. Keys rotate through a process-wide pool (`src/utils/keyPool.js`): each key is used at most once per cooldown window to avoid 429s; when all keys are cooling down, calls wait.
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID` (default `appnBhwjEiHrAZpaa`), `AIRTABLE_TABLE_PROJECTS|IDEAS|SCRIPTS`, `AIRTABLE_TABLE_STORYBOARDS` (default `Storyboard` — sic, matches the live base)
- `STORYBOARD_POLL_MS` — in-process storyboard poll interval for the server; `0`/unset = off (default). n8n used 15 min.
- `YTDLP_PATH` (default `yt-dlp`), `YTDLP_SEARCH_LIMIT` (default 15 per query), `YTDLP_TIMEOUT_MS` (default 60000), `TREND_SCOUT_ENABLED` (default on) — the Trend Scout stage (Node-only addition, no n8n counterpart): a query-planner Gemini call + yt-dlp search metadata that grounds the Research Agent. Degrades gracefully to the original behavior if yt-dlp is missing or fails. The yt-dlp binary is installed separately (`pip install yt-dlp`); on Render add it to the build command.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (default `6626378722`)
- `PORT`, `IDEA_CONCEPT_COUNT` (default 10)
- `AIRTABLE_TABLE_USERS` (default `Users`), `SESSION_TTL_MS` (default eight hours), `SESSION_COOKIE_SECURE` (on in production), `USER_LOCK_DIR` (shared registration locks), `PIPELINE_RATE_LIMIT_MAX`, `PIPELINE_RATE_LIMIT_WINDOW_MS`, `API_READ_RATE_LIMIT_MAX`, `PIPELINE_MAX_CONCURRENCY`, `PIPELINE_MAX_QUEUED`
- `SCHEDULER_POLL_MS`, `SCHEDULE_TIMEZONE` (default `Asia/Singapore`), `SCHEDULE_STATE_PATH` (default `data/schedules.json`), `RUN_STATE_PATH` (default `data/runs.json`), `SCRIPT_LOCK_DIR` (default `data/script-locks`). Hosting needs persistent shared disk for restart recovery and cross-process locking.

## Conventions

- Airtable field names in `transforms.js` mirror the workflow's Airtable schemas. Ideas match on `title` only within the same project; `selected_structure` is normalized `"STRUCTURE 07: X" -> "X"` uppercase — the separator may be a colon or an arrow/dash variant, keep both accepted.
- Dashboard project creation is explicit and retry-safe: a browser-generated request UUID becomes `project_id`. The operator CLI pipeline retains implicit niche/platform matching; HTTP `/niche` is retired (410) to prevent cross-account access. Dashboard login uses Users records with salted password hashes, session cookies, and linked Projects.
- All Airtable writes pass `typecast: true` (config flag `AIRTABLE_TYPECAST`, default on) so near-miss values (numeric strings, new select options) coerce server-side instead of rejecting the record. Keep it on new write methods.
- No silent-empty writes: the flatten transforms warn (`warnIfMostlyEmpty`) when a concept/script maps to mostly empty fields — agent drift should be visible in logs, not masked by `|| ''` fallbacks. Preserve this when adding fields (and nudge the thresholds if the field count grows).
- Telegram alerts are count-safe (dynamic map over saved scripts) — the n8n original's hardcoded `data[0..9]` bug is deliberately not replicated.
- Log memory at stage boundaries with `logger.mem(label)` when adding pipeline stages.

## Relationship to the n8n workspace

The companion repo `D:\n8n-project-claude` holds the n8n workflow JSON files and instance-MCP guidance. Changes here do NOT affect the live n8n workflow, and vice versa. The live workflow remains the source of truth for prompts and Airtable schema.

## TODO (known gaps)

- ~~`content_score` object-vs-number mismatch~~ — resolved: the schema accepts both; `flattenConcept` maps `content_score.overall` to the numeric Airtable column.
- Gemini retries a transient primary or fallback 503 at most twice with short exponential backoff and jitter, then follows the existing primary->fallback and key-pool behavior. It does not retry 429s in place; quota handling still uses fallback and key rotation.

