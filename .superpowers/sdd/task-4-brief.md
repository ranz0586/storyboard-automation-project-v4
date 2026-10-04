# Task 4: Research prompt gains the optional YouTube data section

**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: no git commands. Test runner: `node --test`. `tests/` exists with ytdlp + trendScout tests.

**Files:**
- Modify: `src/agents/research/prompt.js`
- Modify: `src/agents/research/index.js`
- Test: create `tests/researchPrompt.test.js`
- **Do NOT touch:** `src/agents/research/system.js` (VERBATIM n8n copy — hard rule)

**Interfaces:**
- Consumes: `{queries: string[], videos: VideoRow[]}` shape from the Trend Scout (`VideoRow = {title, channel, view_count, upload_date, duration, url}`, fields may be null).
- Produces:
  - `buildResearchPrompt(form, youtubeData?)` — **byte-identical to current output when youtubeData is null/undefined/empty** (this is a hard requirement)
  - `researchAgent(gemini, form, youtubeData?)` — passes data through; youtubeData defaults to null

## Steps (TDD)

**Step 1: Write the failing test** — create `tests/researchPrompt.test.js`:

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

test('with youtubeData the prompt appends the data section listing rows', () => {
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

**Step 2: Run to verify failure**

Run: `node --test tests/researchPrompt.test.js`
Expected: FAIL — second test fails (`buildResearchPrompt` ignores the second argument today, so no `REAL YOUTUBE DATA` section)

**Step 3: Replace `src/agents/research/prompt.js` entirely with** (exact content — the base template text is UNCHANGED from the current file, only the wrapper and new functions are added):

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

**Step 4: Run tests**

Run: `node --test tests/researchPrompt.test.js`
Expected: PASS — 2 tests

**Step 5: Replace `src/agents/research/index.js` entirely with** (exact content):

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

**Step 6: Verify syntax and full test suite**

Run: `node --check src/agents/research/prompt.js && node --check src/agents/research/index.js && node --test tests/`
Expected: exit 0; all 10 tests pass (4 ytdlp + 4 trendScout + 2 researchPrompt)

## Global constraints (binding)

- **`src/agents/research/system.js` must NOT be modified** (verbatim n8n copy).
- The base prompt template text must be preserved character-for-character — when youtubeData is absent, output is byte-identical to today's. Compare carefully against the current file before replacing.
- ESM, no new dependencies. Tests pure-logic only.
- Existing callers (`runPipeline.js`, `pipeline.js`) call `researchAgent(gemini, form)` with two args — the third param MUST be optional with default null so nothing else breaks.
