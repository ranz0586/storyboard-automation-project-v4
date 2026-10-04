# Task 3: Trend Scout agent folder (`src/agents/trendScout/`)

**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: no git commands. Test runner: `node --test`. Agent convention: each agent is a folder with `system.js` (agent definition), `prompt.js` (user prompt builder), `index.js` (runner).

**Files:**
- Create: `src/agents/trendScout/system.js`
- Create: `src/agents/trendScout/prompt.js`
- Create: `src/agents/trendScout/index.js`
- Test: `tests/trendScout.test.js`

**Interfaces:**
- Consumes: `gemini.generate({ system, prompt, json })` (existing `GeminiClient` instance passed in), `searchYouTube(query)` from `src/clients/ytdlp.js` (rejects on failure), `config.ytdlp.enabled` from `src/config.js`, `logger` from `src/utils/logger.js`.
- Produces:
  - `normalizeQueries(raw: unknown): string[]` (exported for tests)
  - `trendScoutAgent(gemini, form): Promise<{queries: string[], videos: VideoRow[]}|null>` — `null` means "no data, degrade gracefully"

## Steps (TDD)

**Step 1: Write the failing test** — create `tests/trendScout.test.js`:

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

**Step 2: Run to verify failure**

Run: `node --test tests/trendScout.test.js`
Expected: FAIL — `Cannot find module '.../src/agents/trendScout/index.js'`

**Step 3: Create `src/agents/trendScout/system.js`** (exact content):

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

**Step 4: Create `src/agents/trendScout/prompt.js`** (exact content):

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

**Step 5: Create `src/agents/trendScout/index.js`** (exact content):

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

**Step 6: Run tests**

Run: `node --test tests/trendScout.test.js`
Expected: PASS — 4 tests

**Step 7: Verify syntax of all three files**

Run: `node --check src/agents/trendScout/system.js && node --check src/agents/trendScout/prompt.js && node --check src/agents/trendScout/index.js`
Expected: exit 0

## Global constraints (binding)

- ESM, Node >= 20, no new npm dependencies.
- Agent folder convention: system.js / prompt.js / index.js — no shared prompts directory.
- Trend Scout is a Node-only addition (no n8n counterpart) — the "verbatim from n8n" rule does NOT apply, and each file carries a comment saying so (system.js and prompt.js do; keep those comments).
- EVERY failure path in trendScoutAgent returns null + logger.warn — never throws, never sends Telegram alerts.
- Caps: max 5 queries, 50 videos total.
- Tests are pure-logic only (normalizeQueries) — no Gemini calls, no yt-dlp spawning.
