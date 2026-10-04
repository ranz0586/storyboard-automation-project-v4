# Task 2: ytdlp client (`src/clients/ytdlp.js`) — TDD on the pure parts

**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: no git commands. Test runner: built-in `node --test` (this creates the repo's FIRST tests — there is no `tests/` directory yet; create it).

**Files:**
- Create: `src/clients/ytdlp.js`
- Test: `tests/ytdlp.test.js`

**Interfaces:**
- Consumes: `config.ytdlp = { path, searchLimit, timeoutMs, enabled }` (already exists in `src/config.js`), `logger` from `src/utils/logger.js`.
- Produces:
  - `parseNdjsonVideos(stdout: string): VideoRow[]` (exported for tests; tolerates bad lines, keeps nulls)
  - `searchYouTube(query: string, { limit?, timeoutMs? } = {}): Promise<VideoRow[]>` — spawns yt-dlp, resolves `[]` on empty stdout, **rejects** on spawn error/timeout/non-zero exit (caller handles degradation)
  - `VideoRow = { title, channel, view_count, upload_date, duration, url }` (each `string|number|null`)

## Steps (TDD — write the test first, watch it fail, then implement)

**Step 1: Write the failing test** — create `tests/ytdlp.test.js`:

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

**Step 2: Run the test to verify it fails**

Run: `node --test tests/ytdlp.test.js` (from D:\n8n-automation-project)
Expected: FAIL — `Cannot find module '.../src/clients/ytdlp.js'`

**Step 3: Implement `src/clients/ytdlp.js`** (exact code):

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

**Step 4: Run the tests to verify they pass**

Run: `node --test tests/ytdlp.test.js`
Expected: PASS — 4 tests pass, pristine output

**Step 5: Verify syntax**

Run: `node --check src/clients/ytdlp.js`
Expected: exit 0

## Global constraints (binding)

- ESM, Node >= 20, NO new npm dependencies (node:test + node:assert only).
- Tests are pure-logic only: they must NOT spawn the yt-dlp binary or touch the network.
- Never log credential values; yt-dlp receives no secrets in argv.
- `searchYouTube` REJECTS on failure (does not swallow) — degradation is the caller's job.
