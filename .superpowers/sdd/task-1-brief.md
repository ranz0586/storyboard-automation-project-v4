# Task 1: Config + .env.example for the ytdlp block

**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: do not run git commands; verification is `node --check`.

**Files:**
- Modify: `src/config.js` (add `ytdlp` block after `gemini`)
- Modify: `.env.example` (document new vars)

**Interfaces produced:** `config.ytdlp = { path: string, searchLimit: number, timeoutMs: number, enabled: boolean }` — consumed by later tasks.

## Steps

**Step 1: Add the `ytdlp` block to `src/config.js`**

Insert after the `gemini: { ... },` block (which ends around line 35), before `airtable:`:

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

**Step 2: Document the vars in `.env.example`**

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

**Step 3: Verify syntax**

Run: `node --check src/config.js`
Expected: no output (exit 0)

## Global constraints (binding)

- ESM project, Node >= 20, no new npm dependencies.
- NOT a git repo — no commits.
- Never print/echo/log credential values.
- Match the surrounding code's comment style and formatting exactly (2-space indent, trailing commas).
