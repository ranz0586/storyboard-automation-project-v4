# yt-dlp Trend Scout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the Research Agent in real YouTube data via a query-planner sub-agent that drives the `yt-dlp` binary for search metadata.

**Architecture:** A new `trendScout` agent folder (Gemini call plans 3–5 YouTube search queries from the niche form) plus a `ytdlp` client (spawns the yt-dlp binary per query, `--flat-playlist --dump-json`, parses NDJSON into compact rows). `pipeline.js` runs the scout before the Research Agent and passes the scouted videos into `buildResearchPrompt` as an optional section. Every failure degrades to `null` — the pipeline then behaves exactly as today.

**Tech Stack:** Node.js ≥20 ESM, `node:child_process` (`execFile`), `node:test` (built-in, no new deps), Gemini via existing `GeminiClient`, yt-dlp external binary.

## Global Constraints

- ESM project (`"type": "module"`), Node >= 20. No build step. No new npm dependencies.
- **NOT a git repository** — there are no commit steps. Each task ends with `node --check` and/or `node --test` verification instead.
- `src/agents/research/system.js` is VERBATIM from n8n — must NOT be touched.
- Agent folder convention: `agents/<name>/system.js` (agent definition), `prompt.js` (user prompt builder), `index.js` (runner). No shared `src/prompts/` directory.
- Memory-conscious: metadata only, no downloads; release scout output after the research call; `logger.mem(label)` at stage boundaries.
- Never print/echo/log credential values. yt-dlp receives no secrets in argv.
- Degrade gracefully: any scout failure → `logger.warn` + `youtubeData = null`; pipeline continues. No Telegram alert, no abort.
- When `youtubeData` is absent, `buildResearchPrompt(form)` output must be byte-identical to today's.
- New env vars: `YTDLP_PATH` (default `yt-dlp`), `YTDLP_SEARCH_LIMIT` (default `15`), `YTDLP_TIMEOUT_MS` (default `60000`), `TREND_SCOUT_ENABLED` (default on, `false` disables).
- Caps: max 5 queries, `YTDLP_SEARCH_LIMIT` results per query, 50 videos total.
- Test runner: `node --test tests/` (built-in `node:test` + `node:assert`). This introduces the repo's first tests — pure-logic only (no network, no binary spawning in tests).

---

### Task 1: Config + .env.example for the ytdlp block

**Files:**
- Modify: `src/config.js` (add `ytdlp` block after `gemini`)
- Modify: `.env.example` (document new vars)

**Interfaces:**
- Produces: `config.ytdlp = { path: string, searchLimit: number, timeoutMs: number, enabled: boolean }` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Add the `ytdlp` block to `src/config.js`**

Insert after the `gemini: { ... },` block (after line 35, before `airtable:`):

```js
  // yt-dlp Trend Scout (Node-only addition; not part of the n8n workflow).
  ytdlp: {
    path: process.env.YTDLP_PATH || 'yt-dlp',
    searchLimit: Number(process.env.YTDLP_SEARCH_LIMIT || 15),
    timeoutMs: Number(process.env.YTDLP_TIMEOUT_MS || 60_000),
    // Default on; set TREND_SCOUT_ENABLED=false to skip the scout entirely.
    enabled: process.env.TREND_SCOUT_ENABLED !== 'false',
  },
```

- [ ] **Step 2: Document the vars in `.env.example`**

Append after the `STORYBOARD_POLL_MS=0` line:

```bash

# ---- yt-dlp Trend Scout (optional; degrades gracefully if missing) ----
# Path to the yt-dlp binary (must be installed separately: pip install yt-dlp).
YTDLP_PATH=yt-dlp
# Search results per planned query (max 5 queries, 50 videos total).
YTDLP_SEARCH_LIMIT=15
# Per-query hard timeout in ms.
YTDLP_TIMEOUT_MS=60000
# Set false to skip the Trend Scout stage entirely.
TREND_SCOUT_ENABLED=true
```

- [ ] **Step 3: Verify syntax**

Run: `node --check src/config.js`
Expected: no output (exit 0)

---

### Task 2: ytdlp client (`src/clients/ytdlp.js`) — TDD on the pure parts

**Files:**
- Create: `src/clients/ytdlp.js`
- Test: `tests/ytdlp.test.js`

**Interfaces:**
- Consumes: `config.ytdlp` from Task 1.
- Produces:
  - `parseNdjsonVideos(stdout: string): Array<{title, channel, view_count, upload_date, duration, url}>` (exported for tests; tolerates bad lines, keeps nulls)
  - `searchYouTube(query: string, { limit?: number, timeoutMs?: number } = {}): Promise<Array<VideoRow>>` — spawns yt-dlp, resolves `[]` on empty stdout, **rejects** on spawn error/timeout/non-zero exit (caller handles degradation)
  - `VideoRow = { title: string|null, channel: string|null, view_count: number|null, upload_date: string|null, duration: number|null, url: string|null }`

- [ ] **Step 1: Write the failing test for NDJSON parsing**

Create `tests/ytdlp.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNdjsonVideos } from '../src/clients/ytdlp.js';

test('parses one video row per NDJSON line, keeping nulls for missing fields', () => {
  const stdout = [
    JSON.stringify({
      title: 'What If Earth Stopped',
      channel: 'WhatIfChannel',
      view_count: 1234567,
      upload_date: '20260715',
      duration: 42,
      url: 'https://www.youtube.com/watch?v=abc123',
    }),
    JSON.stringify({ title: 'No stats video' }), // flat extraction often omits fields
  ].join('\n');

  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    title: 'What If Earth Stopped',
    channel: 'WhatIfChannel',
    view_count: 1234567,
    upload_date: '20260715',
    duration: 42,
    url: 'https://www.youtube.com/watch?v=abc123',
  });
  assert.deepEqual(rows[1], {
    title: 'No stats video',
    channel: null,
    view_count: null,
    upload_date: null,
    duration: null,
    url: null,
  });
});

test('tolerates blank and malformed lines', () => {
  const stdout = '\n{"title":"ok"}\nnot json at all\n\n{"title":"ok2"}\n';
  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'ok');
  assert.equal(rows[1].title, 'ok2');
});

test('falls back to webpage_url and uploader when url/channel missing', () => {
  const stdout = JSON.stringify({
    title: 't',
    uploader: 'SomeUploader',
    webpage_url: 'https://www.youtube.com/watch?v=xyz',
  });
  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows[0].channel, 'SomeUploader');
  assert.equal(rows[0].url, 'https://www.youtube.com/watch?v=xyz');
});

test('returns empty array for empty stdout', () => {
  assert.deepEqual(parseNdjsonVideos(''), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ytdlp.test.js`
Expected: FAIL — `Cannot find module '.../src/clients/ytdlp.js'`

- [ ] **Step 3: Implement `src/clients/ytdlp.js`**

```js
import { execFile } from 'node:child_process';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// Thin wrapper around the yt-dlp binary for YouTube SEARCH METADATA only.
// Node-only addition (no n8n counterpart). Flat extraction: no video pages,
// no downloads, no format resolution — a search returns a few KB of JSON.
//
// The query is passed as an argv element via execFile (no shell), so
// arbitrary user niches can't inject commands.

// Map one flat-playlist entry to a compact row. Missing fields stay null —
// flat extraction often omits stats; do not fabricate values.
function toRow(entry) {
  return {
    title: entry.title ?? null,
    channel: entry.channel ?? entry.uploader ?? null,
    view_count: entry.view_count ?? null,
    upload_date: entry.upload_date ?? null,
    duration: entry.duration ?? null,
    url: entry.url ?? entry.webpage_url ?? null,
  };
}

// yt-dlp --dump-json emits one JSON object per line (NDJSON). Tolerate
// blank/garbage lines — a partial parse is still useful research context.
export function parseNdjsonVideos(stdout) {
  const rows = [];
  for (const line of String(stdout).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      rows.push(toRow(JSON.parse(s)));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

// Run one YouTube search. Resolves to compact rows; REJECTS on spawn
// failure/timeout/non-zero exit — the Trend Scout agent handles degradation.
export function searchYouTube(query, { limit, timeoutMs } = {}) {
  const n = limit ?? config.ytdlp.searchLimit;
  const t = timeoutMs ?? config.ytdlp.timeoutMs;
  const args = [`ytsearch${n}:${query}`, '--dump-json', '--flat-playlist', '--no-warnings'];

  return new Promise((resolve, reject) => {
    execFile(
      config.ytdlp.path,
      args,
      { timeout: t, killSignal: 'SIGKILL', maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (stderr) logger.warn(`yt-dlp stderr (query "${query}")`, String(stderr).slice(0, 500));
        if (err) return reject(err);
        resolve(parseNdjsonVideos(stdout));
      }
    );
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/ytdlp.test.js`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Verify syntax**

Run: `node --check src/clients/ytdlp.js`
Expected: exit 0

---

### Task 3: Trend Scout agent folder (`src/agents/trendScout/`)

**Files:**
- Create: `src/agents/trendScout/system.js`
- Create: `src/agents/trendScout/prompt.js`
- Create: `src/agents/trendScout/index.js`
- Test: `tests/trendScout.test.js`

**Interfaces:**
- Consumes: `gemini.generate({ system, prompt, json })` (existing `GeminiClient`), `searchYouTube(query)` from Task 2, `config.ytdlp` from Task 1.
- Produces:
  - `normalizeQueries(raw: unknown): string[]` (exported for tests; validates/caps the planner's output)
  - `trendScoutAgent(gemini, form): Promise<{queries: string[], videos: VideoRow[]}|null>` — `null` means "no data, degrade" (consumed by Task 5)

- [ ] **Step 1: Write the failing test for query normalization**

Create `tests/trendScout.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueries } from '../src/agents/trendScout/index.js';

test('accepts a plain array of query strings, trimmed', () => {
  assert.deepEqual(normalizeQueries(['  what if shorts ', 'space facts']), [
    'what if shorts',
    'space facts',
  ]);
});

test('unwraps a { queries: [...] } object (LLMs often wrap arrays)', () => {
  assert.deepEqual(normalizeQueries({ queries: ['a', 'b'] }), ['a', 'b']);
});

test('drops non-strings and empties, caps at 5', () => {
  const raw = ['q1', '', 42, null, 'q2', 'q3', 'q4', 'q5', 'q6'];
  assert.deepEqual(normalizeQueries(raw), ['q1', 'q2', 'q3', 'q4', 'q5']);
});

test('returns empty array for garbage input', () => {
  assert.deepEqual(normalizeQueries('not an array'), []);
  assert.deepEqual(normalizeQueries(null), []);
  assert.deepEqual(normalizeQueries({ nope: true }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/trendScout.test.js`
Expected: FAIL — `Cannot find module '.../src/agents/trendScout/index.js'`

- [ ] **Step 3: Create `src/agents/trendScout/system.js`**

```js
// Trend Scout system prompt — NODE-ONLY ADDITION. This agent does NOT exist
// in n8n workflow Zl1MpttLGWdWFqRU, so the "verbatim from n8n" rule does not
// apply here. It plans YouTube search queries that the yt-dlp client executes.
export const TREND_SCOUT_SYSTEM = `You are a YouTube search strategist for short-form content research.

Your ONLY job: given a content niche, platform, audience, and style, produce the 3-5 YouTube search queries most likely to surface CURRENTLY trending short-form videos in that niche.

Rules:
- Queries must be phrases a real viewer would type into YouTube search.
- Cover different angles: the core niche, an emotional/curiosity angle, a format angle (e.g. "shorts"), and an adjacent-topic angle.
- Keep each query under 8 words.
- Do NOT include hashtags, quotes, or boolean operators.

Return ONLY a valid JSON array of query strings, e.g.:
["query one", "query two", "query three"]

No markdown. No explanations. No object wrapper.`;
```

- [ ] **Step 4: Create `src/agents/trendScout/prompt.js`**

```js
// User prompt builder for the Trend Scout query planner (Node-only addition).
export function buildTrendScoutPrompt(form) {
  return `Plan YouTube search queries for trend research on:

NICHE:
${form.NICHE || ''}

PLATFORM:
${form.PLATFORM || ''}

TARGET AUDIENCE:
${form['TARGET AUDIENCE'] || ''}

CONTENT STYLE:
${form['CONTENT STYLE'] || ''}

CHANNEL DESCRIPTION:
${form['CHANNEL DESCRIPTION (Optional)'] || ''}

Return ONLY the JSON array of 3-5 search query strings.`;
}
```

- [ ] **Step 5: Create `src/agents/trendScout/index.js`**

```js
import { TREND_SCOUT_SYSTEM } from './system.js';
import { buildTrendScoutPrompt } from './prompt.js';
import { searchYouTube } from '../../clients/ytdlp.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

const MAX_QUERIES = 5;
const MAX_TOTAL_VIDEOS = 50;

// Validate/cap the planner's output. Exported for tests.
// LLMs sometimes wrap the array ({ "queries": [...] }) — unwrap that shape.
export function normalizeQueries(raw) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.queries) ? raw.queries : [];
  return arr
    .filter((q) => typeof q === 'string' && q.trim())
    .map((q) => q.trim())
    .slice(0, MAX_QUERIES);
}

// Trend Scout: plan queries with Gemini, execute them with yt-dlp, return
// compact video metadata for the Research Agent's prompt.
// EVERY failure path returns null — the pipeline must degrade gracefully
// (research runs without real data), never abort because of scraping.
export async function trendScoutAgent(gemini, form) {
  if (!config.ytdlp.enabled) {
    logger.info('Trend Scout disabled (TREND_SCOUT_ENABLED=false)');
    return null;
  }

  let queries;
  try {
    const raw = await gemini.generate({
      system: TREND_SCOUT_SYSTEM,
      prompt: buildTrendScoutPrompt(form),
      json: true,
    });
    queries = normalizeQueries(raw);
  } catch (err) {
    logger.warn('Trend Scout query planning failed — continuing without YouTube data', err?.message);
    return null;
  }
  if (!queries.length) {
    logger.warn('Trend Scout planner returned no usable queries — continuing without YouTube data');
    return null;
  }
  logger.info(`Trend Scout queries: ${queries.join(' | ')}`);

  // One query failing must not abort the scout — collect what we can.
  const videos = [];
  for (const query of queries) {
    if (videos.length >= MAX_TOTAL_VIDEOS) break;
    try {
      const rows = await searchYouTube(query);
      videos.push(...rows.slice(0, MAX_TOTAL_VIDEOS - videos.length));
      logger.info(`Trend Scout "${query}": ${rows.length} videos`);
    } catch (err) {
      logger.warn(`Trend Scout yt-dlp failed for "${query}"`, err?.message);
    }
  }

  if (!videos.length) {
    logger.warn('Trend Scout found no videos — continuing without YouTube data');
    return null;
  }
  return { queries, videos };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/trendScout.test.js`
Expected: PASS — 4 tests pass

- [ ] **Step 7: Verify syntax of all three files**

Run: `node --check src/agents/trendScout/system.js && node --check src/agents/trendScout/prompt.js && node --check src/agents/trendScout/index.js`
Expected: exit 0

---

### Task 4: Research prompt gains the optional YouTube data section

**Files:**
- Modify: `src/agents/research/prompt.js`
- Modify: `src/agents/research/index.js`
- Test: `tests/researchPrompt.test.js`
- **Do NOT touch:** `src/agents/research/system.js` (verbatim n8n copy)

**Interfaces:**
- Consumes: `{queries, videos}` shape from Task 3.
- Produces:
  - `buildResearchPrompt(form, youtubeData?)` — byte-identical to current output when `youtubeData` is null/undefined/empty
  - `researchAgent(gemini, form, youtubeData?)` — consumed by Task 5

- [ ] **Step 1: Write the failing test**

Create `tests/researchPrompt.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPrompt } from '../src/agents/research/prompt.js';

const form = {
  NICHE: 'What If',
  PLATFORM: 'Facebook',
  'TARGET AUDIENCE': 'US',
  'CONTENT STYLE': 'Edutainment',
  'CHANNEL DESCRIPTION (Optional)': 'What If FIFA, grounded physics',
};

test('without youtubeData the prompt is unchanged (no data section, backward compatible)', () => {
  const base = buildResearchPrompt(form);
  assert.ok(!base.includes('REAL YOUTUBE DATA'));
  // Absent and empty youtubeData produce the identical prompt.
  assert.equal(buildResearchPrompt(form, null), base);
  assert.equal(buildResearchPrompt(form, undefined), base);
  assert.equal(buildResearchPrompt(form, { queries: [], videos: [] }), base);
});

test('with youtubeData the prompt appends the data section grouped by nothing, listing rows', () => {
  const youtubeData = {
    queries: ['what if shorts'],
    videos: [
      {
        title: 'What If Earth Stopped',
        channel: 'WhatIfChannel',
        view_count: 1234567,
        upload_date: '20260715',
        duration: 42,
        url: 'https://www.youtube.com/watch?v=abc123',
      },
      { title: 'Sparse row', channel: null, view_count: null, upload_date: null, duration: null, url: null },
    ],
  };
  const p = buildResearchPrompt(form, youtubeData);
  assert.ok(p.startsWith(buildResearchPrompt(form))); // base prompt is a strict prefix
  assert.ok(p.includes('REAL YOUTUBE DATA (via yt-dlp)'));
  assert.ok(p.includes('what if shorts'));
  assert.ok(p.includes('"What If Earth Stopped" — WhatIfChannel, 1234567 views, uploaded 20260715, 42s'));
  assert.ok(p.includes('"Sparse row"')); // null fields are simply omitted, not printed as "null"
  assert.ok(!p.includes('null'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/researchPrompt.test.js`
Expected: FAIL — second test fails (`buildResearchPrompt` ignores the second argument today, so no `REAL YOUTUBE DATA` section)

- [ ] **Step 3: Modify `src/agents/research/prompt.js`**

Replace the whole file with:

```js
// User prompt template — equivalent of the n8n Research Agent node's "text" (prompt) field.
// The optional youtubeData section is a Node-only addition (Trend Scout);
// when youtubeData is absent the output is byte-identical to the n8n port.
export function buildResearchPrompt(form, youtubeData) {
  const base = `Research trending short-form content opportunities for the following:

NICHE:
${form.NICHE || ''}

PLATFORM:
${form.PLATFORM || ''}

TARGET AUDIENCE:
${form['TARGET AUDIENCE'] || ''}

CONTENT STYLE:
${form['CONTENT STYLE'] || ''}

CHANNEL DESCRIPTION:
${form['CHANNEL DESCRIPTION (Optional)'] || ''}

GOAL:
Identify:
- trending topics
- emotional drivers
- viral storytelling patterns
- audience psychology
- oversaturated formats
- underserved content opportunities
- high-retention hook styles
- visual trends
- replay-driving mechanics

Focus on:
- emotionally believable trends
- platform-native behavior
- psychologically engaging content
- scalable content opportunities

Avoid:
- generic ideas
- stale trends
- obvious content suggestions
- repetitive viral formats

Generate a structured research intelligence report optimized for downstream AI content agents.`;

  if (!youtubeData?.videos?.length) return base;
  return base + formatYoutubeData(youtubeData);
}

// Compact one video row: null fields are omitted entirely (never print "null").
function formatVideoLine(v) {
  const parts = [`"${v.title ?? 'Untitled'}"`];
  const meta = [
    v.channel,
    v.view_count != null ? `${v.view_count} views` : null,
    v.upload_date ? `uploaded ${v.upload_date}` : null,
    v.duration != null ? `${v.duration}s` : null,
  ].filter((x) => x != null);
  if (meta.length) parts.push(meta.join(', '));
  return `- ${parts.join(' — ')}`;
}

function formatYoutubeData({ queries = [], videos = [] }) {
  return `

REAL YOUTUBE DATA (via yt-dlp):
The following are actual current YouTube search results for this niche (queries: ${queries.join('; ')}).
Ground your trend analysis in this real data where relevant — treat titles, view counts, and upload dates as evidence of what is currently working.

${videos.map(formatVideoLine).join('\n')}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/researchPrompt.test.js`
Expected: PASS — 2 tests pass

- [ ] **Step 5: Modify `src/agents/research/index.js` to thread the data through**

Replace the whole file with:

```js
import { RESEARCH_SYSTEM } from './system.js';
import { buildResearchPrompt } from './prompt.js';

// Replicates the "Research Agent" node. youtubeData (optional) comes from the
// Trend Scout (Node-only addition) — null means "no real data, run as n8n did".
export async function researchAgent(gemini, form, youtubeData = null) {
  // Returns the raw research report object; downstream only needs it as context.
  return gemini.generate({
    system: RESEARCH_SYSTEM,
    prompt: buildResearchPrompt(form, youtubeData),
    json: true,
  });
}
```

- [ ] **Step 6: Verify syntax and full test suite**

Run: `node --check src/agents/research/prompt.js && node --check src/agents/research/index.js && node --test tests/`
Expected: exit 0; all 10 tests pass

---

### Task 5: Wire the Trend Scout into `pipeline.js`

**Files:**
- Modify: `src/pipeline.js`

**Interfaces:**
- Consumes: `trendScoutAgent(gemini, form)` (Task 3), `researchAgent(gemini, form, youtubeData)` (Task 4).
- Produces: no interface change — `runContentPipeline` signature and return value are unchanged.

- [ ] **Step 1: Add the import**

In `src/pipeline.js`, after the `researchAgent` import (line 3), add:

```js
import { trendScoutAgent } from './agents/trendScout/index.js';
```

- [ ] **Step 2: Insert the scout stage and thread data into research**

Replace the current step-2 block:

```js
  // 2. Research Agent
  let research = await researchAgent(gemini, form);
  logger.mem('after:research');
```

with:

```js
  // 2a. Trend Scout (Node-only addition): plan YouTube queries, run yt-dlp
  //     for real search metadata. Null on any failure — research then runs
  //     exactly as the n8n original did.
  let youtubeData = await trendScoutAgent(gemini, form);
  logger.mem('after:trendScout');

  // 2b. Research Agent (grounded in real YouTube data when available)
  let research = await researchAgent(gemini, form, youtubeData);
  // Release the scouted metadata once research has consumed it.
  youtubeData = null;
  logger.mem('after:research');
```

- [ ] **Step 3: Verify syntax and full suite**

Run: `node --check src/pipeline.js && node --test tests/`
Expected: exit 0; all tests pass

---

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

### Task 7: End-to-end verification (manual, requires yt-dlp + .env)

**Files:** none created — verification only.

- [ ] **Step 1: Confirm yt-dlp is installed locally**

Run: `yt-dlp --version`
Expected: a version string (e.g. `2026.07.xx`). If missing: `pip install yt-dlp` or `winget install yt-dlp`.

- [ ] **Step 2: Smoke-test the client directly**

Run: `node -e "import('./src/clients/ytdlp.js').then(async m => { const r = await m.searchYouTube('what if shorts', { limit: 3 }); console.log(JSON.stringify(r, null, 2)); })"`
Expected: JSON array of up to 3 rows with title/channel/url populated (view_count may be null in flat mode).

- [ ] **Step 3: Degradation check (no real keys needed)**

Run: `YTDLP_PATH=definitely-missing node -e "import('./src/clients/ytdlp.js').then(m => m.searchYouTube('x').catch(e => console.log('rejected as expected:', e.code)))"`
Expected: `rejected as expected: ENOENT`

- [ ] **Step 4: Full pipeline run (uses real API keys — ask the owner before running)**

Run: `npm run pipeline`
Expected in logs, in order: `Trend Scout queries: ...`, per-query `Trend Scout "...": N videos`, `MEM after:trendScout`, `MEM after:research`. The run completes with scripts saved, same as before.

- [ ] **Step 5: Disabled-flag check**

Run: `TREND_SCOUT_ENABLED=false npm run pipeline` (or set in `.env`)
Expected: log line `Trend Scout disabled (TREND_SCOUT_ENABLED=false)`, pipeline behaves exactly as pre-change.

---

## Deployment note (Render)

Not a code task — for the owner: add yt-dlp to the Render build command, e.g.
`pip install yt-dlp && npm install`, or download the standalone Linux binary
into the app directory during build and set `YTDLP_PATH` accordingly. If
absent, the scout logs a warning per query and research runs ungrounded.
