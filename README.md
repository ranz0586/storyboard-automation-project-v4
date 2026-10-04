# n8n-automation-project

Dashboard-controlled, memory-efficient Node.js implementation of the n8n workflow **Video Script Generation Flow Agentic v4** (`Zl1MpttLGWdWFqRU`).

The dashboard at `/` is the primary control plane. It supports explicit Airtable projects, project statistics, idea generation, count-based and selected-idea script runs, live progress, safe failure retry, and weekly schedules. The original `/niche` full pipeline remains available for compatibility.

It reproduces the `NicheForm` branch as a plain Node service:

```
Form (POST /niche)
  -> Save Project (Airtable)
  -> Trend Scout (yt-dlp, optional)
  -> Research Agent (Gemini)
  -> Idea Agent -> N ranked concepts (Gemini, structured)
  -> for each concept:
        Save Idea (Airtable upsert by title within the linked Project)
        Script Agent -> 1 script (Gemini, structured)
        Save Script (atomic Airtable upsert by deterministic video_id)
  -> Telegram "scripts generated" alert
```

The `Storyboard Agent` (the workflow's Schedule-trigger branch) is ported as a poller
(`src/storyboardPipeline.js`). Script lifecycle: **Draft → Approved (manual, in Airtable) →
Story Generated**. Each poll picks up `Approved` scripts, resolves the linked Project
(niche/platform/character + style references), generates the storyboard package, upserts it
into the `Storyboard` table (rows are keyed by `storyboard_id` = the script's `video_id`),
and marks the script `Story Generated`.

## Why per-concept looping

The n8n version fed all 10 concepts to the Script Agent in one call and held every script in
memory at once (plus large shared Postgres chat memory), which contributed to the >500MB OOM on
the 512MB host. This port generates and persists **one script at a time**, so peak memory holds a
single script. Heap/RSS is logged after each stage (`logger.mem`).

## Setup

```bash
cd D:\n8n-automation-project
npm install
copy .env.example .env   # then fill in secrets
pip install yt-dlp       # optional — grounds research in real YouTube data
```

`yt-dlp` is optional: with it installed the Trend Scout stage grounds research in real YouTube
search data; without it the pipeline still runs, the research is just ungrounded.

Fill `.env`:
- `GEMINI_API_KEYS` — comma-separated Google Generative AI keys (n8n `googlePalmApi`). Each key
  is used at most once per `GEMINI_KEY_COOLDOWN_MS` (default 5 min) to dodge free-tier 429s —
  more keys = more throughput. A single legacy `GEMINI_API_KEY` also works.
- `AIRTABLE_API_KEY` — an Airtable personal access token (`pat...`; legacy `key...` API keys were
  retired Feb 2024) with `data.records:read`/`write` scopes and the base added as a resource.
- `AIRTABLE_BASE_ID` (defaults to the workflow's base `appnBhwjEiHrAZpaa`).
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
- `GEMINI_MODEL_PRIMARY` / `GEMINI_MODEL_FALLBACK` mirror the primary+fallback Gemini nodes.
- `AIRTABLE_TABLE_USERS` - account table (default `Users`); see the schema below.
- `SESSION_TTL_MS` - session duration (default eight hours). `SESSION_COOKIE_SECURE` defaults to true in production.
- `USER_LOCK_DIR` - shared persistent directory for unique-username registration locks.
- `SCHEDULE_TIMEZONE` / `SCHEDULE_STATE_PATH` — weekly scheduler timezone and durable local state path. Configure persistent hosting storage for the state path.

## Run

Newly generated scripts pass through `Script Agent -> Script Validation Agent -> Airtable` in the shared script worker. The validator reviews and repairs narration/visual alignment for each scene; deterministic checks enforce 150–180 WPM after subtracting TTS before/after pauses, exact full-voiceover/scene narration agreement, sequential scene numbering, and matching total duration. A three-second scene permits 8–9 words without pauses, or 8 words with a 100 ms pause. Essential overflow is split into more scenes using the chosen scene duration rather than stretching clips. Deliberate silent visual scenes are exempt from the speech-rate minimum.

Validation adds one Gemini call per new script, with at most one correction call if checks still fail. Both use the existing key cooldown and primary/fallback client. Rejected or unavailable validation prevents the Script write and leaves the Idea Draft for retry. Accepted scenes store their calculated `tts.speaking_rate_wpm` in `scenes_json`; no Airtable schema changes are required. Existing usable saved scripts continue to be reused idempotently. This validates planned narration and visual descriptions, not rendered audio or video.

Newly generated scripts pass through `Script Agent -> Script Validation Agent -> Airtable` in the shared script worker. The validator reviews and repairs narration/visual alignment for each scene; deterministic checks enforce 150–180 WPM after subtracting TTS before/after pauses, exact full-voiceover/scene narration agreement, sequential scene numbering, and matching total duration. A three-second scene permits 8–9 words without pauses, or 8 words with a 100 ms pause. Essential overflow is split into more scenes using the chosen scene duration rather than stretching clips. Deliberate silent visual scenes are exempt from the speech-rate minimum.

Validation adds one Gemini call per new script, with at most one correction call if checks still fail. Both use the existing key cooldown and primary/fallback client. Rejected or unavailable validation prevents the Script write and leaves the Idea Draft for retry. Accepted scenes store their calculated `tts.speaking_rate_wpm` in `scenes_json`; no Airtable schema changes are required. Existing usable saved scripts continue to be reused idempotently. This validates planned narration and visual descriptions, not rendered audio or video.

```bash
npm start                 # builds the React UI, then starts Express
npm run dev               # backend with --watch (first development terminal)
npm run dev:ui            # React/Vite hot reload at http://127.0.0.1:5173 (second terminal)
npm run build             # production UI output in dist/
npm run pipeline          # one-shot run with the sample form in src/runPipeline.js
npm run storyboard        # one-shot storyboard poll — cron this (n8n used 15 min),
                          # or set STORYBOARD_POLL_MS for an in-process interval
npm run recover-ideas     # regenerate scripts for ideas stuck in Draft/blank status
                          # (e.g. after a failed run); optional limit: -- 5
npm test                  # pure-logic test suite (no network or yt-dlp calls)
npm run test:ui           # production build + browser workflow tests (external services mocked)
npm run test:all          # backend and browser suites
```

With the server running, open `http://localhost:3000/`. Choose **Create an account**, enter your full name, email, username and a password of at least 12 characters. Subsequent visits use **Log in**. Dashboard API-token connection has been removed; Airtable and Gemini credentials remain server-side.

The dashboard uses React JSX and Vite. Use Node 20.19+ or 22.12+ (Node 24 works). For UI development, run the two development commands above and open the Vite URL; `/api` requests are proxied to Express on port 3000, preserving same-origin cookies and write protection. Set `UI_API_TARGET` in the terminal running Vite if the backend uses another port. Agents and pipeline execution continue to run on the server.

Environment settings are loaded when Express starts. After changing Gemini model settings in `.env`, restart the backend (`npm start` or `npm run dev`), then confirm the `Gemini models:` startup log. Vite hot reload and refreshing the browser do not reload backend configuration. Retry creates a new run using the server's loaded configuration; the original failed run keeps its historical error message.

For deployment, run `npm ci --include=dev` and `npm run build` in the build phase. `npm start` rebuilds when Vite is installed; if development dependencies are omitted after the build, it uses the existing `dist/` artifacts. Include `dist/` in the deployed artifact. Do not serve JSX source directly from Express.

Install the browser once with `npx playwright install chromium` before `npm run test:ui`. Browser tests use an isolated local fixture with real authentication, API routes, controllers, agent validation, transforms, workers, scheduling, recovery and storyboard execution. Gemini, Airtable, Telegram and YouTube are mocked; these tests do not claim live provider verification. Traces on failure and desktop/mobile screenshots are saved under `test-results/`.

The Airtable `Users` table needs these fields:

| Field | Type | Purpose |
| --- | --- | --- |
| username | Single line text (primary) | Unique lowercase username, 3-64 letters, numbers, dots, underscores or dashes |
| full_name | Single line text | User's name |
| email | Email | Contact information |
| password_hash | Long text | Application-generated salted scrypt hash; never enter plaintext |
| status | Single select: Active, Disabled | Enable or disable login |
| Projects | Link to Projects, multiple allowed | Projects accessible to this user |

The configured base `app1BZ6noG7rzCUhw` now has this table and the reciprocal `Projects.Users` linked-record field. Other bases require the same schema. Airtable record IDs, rather than custom project keys, are used for these account links.

New projects are linked automatically. Assign existing projects to an account by selecting them in `Users.Projects` in Airtable. New accounts start without access to existing projects. Project reads, generation, approvals, schedules, and run history are restricted to linked projects. Account/project access changes take effect on the next request. Disabling an account or changing its password hash invalidates its sessions.

Sessions use opaque HttpOnly, SameSite=Strict cookies; HTTPS production cookies also use Secure. Passwords use salted scrypt (N=32768, r=8, p=3), following [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Login and registration are rate limited, and browser writes require the same-origin dashboard header. Sessions are held in process memory: restarting the server logs users out, and multi-instance deployments require sticky routing or a future shared session store. Registration locks must use a shared persistent disk across processes.

Authentication endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, and `POST /api/auth/logout`. Send JSON and `X-Dashboard-Request: 1` on writes; the browser sends the session cookie automatically. No password hashes are returned to the browser.

The implicit-project `POST /niche` endpoint now returns 410 for logged-in users. Use project-bound idea runs and script runs in the dashboard. The one-shot CLI pipeline remains available for operator use.

## Layout

```
client/
  index.html           Vite HTML entry
  src/                 React JSX dashboard, API wrapper, and styles
dist/                  generated production UI, served by Express at / (gitignored)
tests/ui/              browser workflow tests and isolated external-service fixture
src/
  config.js            env-backed config
  index.js             server/scheduler entry
  app.js               Express app and authenticated APIs
  runPipeline.js       standalone one-shot runner
  pipeline.js          orchestrator (Research->Idea->per-concept Script)
  ideaGeneration.js    explicit-project Research->Idea execution
  scriptWorker.js      shared idempotent, sequential script worker
  http/                auth, validation, throttling, bounded queue
  runs/                run state, progress, script/idea controllers
  schedules/           weekly schedule persistence and due-checker
  agents/<name>/       one folder per agent: system.js (n8n system message, verbatim),
                       prompt.js (n8n prompt/text field), index.js (runner)
  schemas.js           zod schemas (replace Structured Output Parsers)
  transforms.js        Flatten Concept / Flatten Script (Code nodes)
  clients/             gemini (primary+fallback), airtable, telegram, ytdlp
  utils/               logger (with mem snapshots), json extractor
```

## Notes / TODO

- Agent system messages (`src/agents/*/system.js`) are verbatim copies of the n8n nodes' system
  messages; `prompt.js` files mirror each node's prompt/text field (the Script Agent's is adapted
  to one-concept-per-call).
- No chat memory is used (the agents are single-shot transforms). Add one only if a stage needs it.
- Airtable field names assume the workflow's schema; adjust in `transforms.js` if your tables differ.
- Storyboards can run one-shot with `npm run storyboard` or through `STORYBOARD_POLL_MS`.
- In-process storyboard polling shares the same bounded queue as dashboard and scheduled work.
- Run history (`RUN_STATE_PATH`) and schedules (`SCHEDULE_STATE_PATH`) use locked, atomic read-modify-write transactions. Multiple server processes on the **same host** must use the same state paths and lock directories. Live owners are preserved; exited owners become interrupted, and schedule occurrence IDs prevent duplicate claims. Cross-host deployments need a shared database/coordinator. Queue limits, Gemini cooldowns and login sessions remain process-local.
- If a process crashes while holding a short state transaction, recovery fails closed. Stop **all** servers, run `node scripts/recover-state-locks.mjs --servers-stopped`, then restart. The command refuses live owners and does not delete run/schedule data. Script-generation locks retain their ten-minute lease-expiry recovery behavior.
- The dashboard paginates projects and eligible ideas; up to 50 selected idea IDs are retained across pages. Interrupted script runs expose a resume action, and storyboard/recovery outcomes appear in project activity. Unlinked legacy records cannot produce account-scoped activity; their errors remain in logs/alerts.
- Storyboard workers share per-script filesystem locks, re-read Script status, reject empty production packages and reuse usable persisted output when only the completion status needs retrying. No original n8n system prompt was changed.
- Verification scripts: `node scripts/verify-gemini-models.mjs` reads provider metadata; `node scripts/verify-live-script.mjs` performs live Gemini generation/validation with local persistence only. `--resume` reuses captured live replies for one correction, and `--control` uses a compliant generation fixture with live validation. These live commands consume provider quota; they never initialize Airtable or Telegram clients. `node scripts/benchmark-dashboard.mjs` is entirely mocked.
- Airtable stable-key writes use the Web API's `performUpsert`; the configured token therefore needs normal record read/write access.
