# Task 6 Report: package.json test script + docs

Status: **DONE_WITH_CONCERNS** (one deliberate deviation from the brief, documented below)

## Changes, file by file

### 1. `package.json`

Added a `test` script after `recover-ideas` (comma added to the preceding line):

```json
"recover-ideas": "node src/runIdeaRecovery.js",
"test": "node --test \"tests/**/*.test.js\""
```

**Deviation from the brief.** The brief specified `node --test tests/`. That command **fails on
the Node version installed here (v24.14.1)** — a bare directory argument is resolved as a module
path and throws:

```
Error: Cannot find module 'D:\n8n-automation-project\tests'
```

Probed variants:

| Command | Result |
|---|---|
| `node --test tests/` | FAIL (MODULE_NOT_FOUND) |
| `node --test tests` | FAIL |
| `node --test ./tests` | FAIL |
| `node --test "D:/n8n-automation-project/tests"` | FAIL |
| `node --test` (no arg, default discovery) | 10/10 pass |
| `node --test tests/*.test.js` (shell-expanded) | 10/10 pass |
| `node --test "tests/**/*.test.js"` (Node-internal glob) | 10/10 pass |

Chose the quoted glob because it is shell-independent (Node expands it internally, so it behaves
identically under bash, cmd.exe, and PowerShell — relevant on Windows) and it is explicitly scoped
to `tests/`, unlike bare `node --test`, which would also discover any future `*.test.js` under
`src/`. `npm test` runs the suite and passes; the brief's *intent* ("`npm test` runs the tests") is
satisfied.

### 2. `CLAUDE.md`

Four surgical edits, all as specified by the brief except for the command string noted above.

1. **Commands** — replaced `- No test suite yet. Syntax check: node --check <file>.` with the
   `npm test` bullet. Used the brief's wording verbatim apart from the command string, plus one
   added sentence recording *why* the glob is there, so a future reader doesn't "fix" it back to
   `tests/` and break the script (this repo's CLAUDE.md already uses that don't-fix-this pattern —
   cf. the `gemini-3.5-flash` note):

   > - `npm test` — `node --test "tests/**/*.test.js"` (pure-logic tests only: NDJSON parsing, query normalization, prompt building; no network/binary calls). Note: the glob is deliberate — on current Node (verified v24) a bare directory (`node --test tests/`) is treated as a module path and fails. Syntax check: `node --check <file>`.

2. **Layout tree** — agents line now reads `(research, idea, script, storyboard, trendScout):`;
   clients line now reads `gemini (primary+fallback), airtable, telegram, ytdlp (spawns yt-dlp binary)`.
   Both verbatim from the brief. Column alignment of the tree preserved.

3. **Environment variables** — added the `YTDLP_PATH` / `YTDLP_SEARCH_LIMIT` / `YTDLP_TIMEOUT_MS` /
   `TREND_SCOUT_ENABLED` bullet verbatim, positioned immediately after the `STORYBOARD_POLL_MS`
   bullet (line 78) and before `TELEGRAM_BOT_TOKEN`, as specified.

4. **Hard rules** — appended the Trend Scout sentence verbatim to the end of the existing
   verbatim-prompts bullet, directly after the Script Agent exception sentence (same bullet, not a
   new one — the brief said "add to the rule").

### 3. `src/pipeline.js` (folded-in Task 5 review finding)

Comment sketch only, no code touched. Was:

```js
//   Save Project -> Research -> Idea -> (per concept) Save Idea -> Script -> Save Script
//   -> Telegram alert
```

Now:

```js
//   Save Project -> Trend Scout (yt-dlp, optional) -> Research -> Idea
//     -> (per concept) Save Idea -> Script -> Save Script
//   -> Telegram alert
```

Wrapped across two lines because the single line would otherwise run long; the continuation is
indented to read as a continuation of the chain.

Note: the top-level pipeline sketch in `CLAUDE.md` ("What this repo is", lines 11-18) was **not**
changed — the brief scoped the sketch edit to `src/pipeline.js` and scoped CLAUDE.md to three
specific edits. Flagging it as a possible follow-up since that sketch is now also incomplete.

## Verification

```
$ npm test
> node --test "tests/**/*.test.js"

✔ without youtubeData the prompt is unchanged (no data section, backward compatible)
✔ with youtubeData the prompt appends the data section listing rows
✔ accepts a plain array of query strings, trimmed
✔ unwraps a { queries: [...] } object (LLMs often wrap arrays)
✔ drops non-strings and empties, caps at 5
✔ returns empty array for garbage input
✔ parses one video row per NDJSON line, keeping nulls for missing fields
✔ tolerates blank and malformed lines
✔ falls back to webpage_url and uploader when url/channel missing
✔ returns empty array for empty stdout
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

10/10 pass, pristine output (no warnings, no stderr noise).

```
$ node --check src/pipeline.js && node --check src/index.js && node --check src/runPipeline.js
node --check: exit 0

$ node -e "JSON.parse(...package.json)"
package.json: valid JSON
```

The brief's step-3 check (`node --check src/index.js && node --check src/runPipeline.js`) passes,
plus `src/pipeline.js` for the comment edit.

## Self-review notes

- Every brief item accounted for: package.json test script (deviated on the command string only,
  with cause), all three CLAUDE.md edits + the Hard rules addition, pipeline.js comment sketch.
- Nothing else changed. No `src/agents/*/system.js` files touched. No new npm dependencies. No
  files created other than this report. No git commands run (repo is not a git repo).
- Cross-checked the documented defaults against `src/config.js` lines 38-42: `YTDLP_PATH` →
  `'yt-dlp'`, `YTDLP_SEARCH_LIMIT` → `15`, `YTDLP_TIMEOUT_MS` → `60_000`, `TREND_SCOUT_ENABLED` →
  `!== 'false'` (i.e. default on). All four match the doc bullet. `.env.example` (lines 42-48)
  agrees.
- CLAUDE.md reads coherently around the edits: the Commands bullet sits last in its list where the
  removed line was; the layout tree still aligns; the env bullet matches the surrounding
  "`VAR` (default X) — prose" style; the Hard rules sentence continues the existing bullet's
  argument without contradicting the verbatim rule (it carves out a documented exception).

## Concerns

1. `node --test tests/` from the brief does not work on Node 24; used
   `node --test "tests/**/*.test.js"` instead and documented the reason in CLAUDE.md. If the plan
   or another task's docs quote `node --test tests/`, they need the same correction.
2. The `CLAUDE.md` "What this repo is" pipeline sketch (lines 11-18) still omits the Trend Scout
   stage. Out of scope per the brief; worth a one-line follow-up.
