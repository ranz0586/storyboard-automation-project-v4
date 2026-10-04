### Task 6: package.json test script + docs (CLAUDE.md, README if present)

**Files:**
- Modify: `package.json` (add `test` script)
- Modify: `CLAUDE.md` (commands section, layout, env vars — keep edits surgical)

**Interfaces:**
- Consumes: everything above.
- Produces: `npm test` runs `node --test tests/`.

- [ ] **Step 1: Add the test script to `package.json`**

In `"scripts"`, after the `"recover-ideas"` line, add:

```json
    "test": "node --test tests/"
```

(Remember the comma on the preceding line.)

- [ ] **Step 2: Update `CLAUDE.md`**

Three surgical edits:

1. In **Commands**, replace the line `- No test suite yet. Syntax check: node --check <file>.` with:

```markdown
- `npm test` — `node --test tests/` (pure-logic tests only: NDJSON parsing, query normalization, prompt building; no network/binary calls). Syntax check: `node --check <file>`.
```

2. In the **Layout** tree, update the agents line and clients line:

```
  agents/<name>/       ONE folder per agent (research, idea, script, storyboard, trendScout):
```

```
  clients/             gemini (primary+fallback), airtable, telegram, ytdlp (spawns yt-dlp binary)
```

3. In **Environment variables**, add after the `STORYBOARD_POLL_MS` bullet:

```markdown
- `YTDLP_PATH` (default `yt-dlp`), `YTDLP_SEARCH_LIMIT` (default 15 per query), `YTDLP_TIMEOUT_MS` (default 60000), `TREND_SCOUT_ENABLED` (default on) — the Trend Scout stage (Node-only addition, no n8n counterpart): a query-planner Gemini call + yt-dlp search metadata that grounds the Research Agent. Degrades gracefully to the original behavior if yt-dlp is missing or fails. The yt-dlp binary is installed separately (`pip install yt-dlp`); on Render add it to the build command.
```

Also add to the **Hard rules** verbatim-prompts rule, after the Script Agent exception sentence:

```markdown
The Trend Scout agent (`agents/trendScout/`) is a Node-only addition with no n8n counterpart — the verbatim rule does not apply to it, and `research/prompt.js` only appends an optional data section (absent = byte-identical to the n8n port).
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: all tests pass (10 tests)

Run: `node --check src/index.js && node --check src/runPipeline.js`
Expected: exit 0 (entry points still parse with the new imports)

---


**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: no git commands, no commits. Test runner: `node --test tests/`.

**Additional item folded into this doc task (Task 5 review finding):** the header comment sketch at `src/pipeline.js` lines ~9-11 shows `Save Project -> Research Agent -> Idea Agent -> ...` and omits the new Trend Scout stage. Update that comment sketch to include the scout stage between Save Project and Research Agent (e.g. `-> Trend Scout (yt-dlp, optional) -> Research Agent`). Touch ONLY that comment in pipeline.js — no code changes.

**Global constraints that bind this task:**
- `src/agents/*/system.js` files are VERBATIM n8n copies — do not touch.
- CLAUDE.md edits must fit the existing document's voice and structure; do not rewrite unrelated sections.
- No new npm dependencies.
