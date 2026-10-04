# yt-dlp Trend Scout Sub-Agent — Design

**Date:** 2026-08-02
**Status:** Approved by owner (conversation), pending spec review

## Purpose

Ground the Research Agent in real YouTube data. Today the Research Agent
(`src/agents/research/`) generates its trend intelligence report purely from
Gemini's parametric knowledge. This feature adds a **Trend Scout** sub-agent
that runs before it: a small Gemini call plans YouTube search queries from the
niche form, `yt-dlp` fetches real search-result metadata for those queries, and
the compacted results are injected into the Research Agent's user prompt as a
"REAL YOUTUBE DATA" section.

Decisions made during brainstorming:

- **Data scope:** search metadata only (titles, channels, view counts, upload
  dates, durations, URLs). No transcripts, no comments, no channel deep-dives,
  no media downloads.
- **Architecture:** query-planner sub-agent (LLM plans queries; yt-dlp
  executes; results injected into the research prompt). Not a function-calling
  tool loop, not a deterministic query builder.
- **Runtime:** the real `yt-dlp` binary via `child_process`, not an npm
  scraping library or the YouTube Data API.
- **Failure mode:** degrade gracefully — any scout failure logs a warning and
  the pipeline runs the Research Agent exactly as it does today.

## Pipeline change

`src/pipeline.js` step 2 becomes:

```
2a. Trend Scout (query planner)   Gemini call: form -> 3-5 search queries (JSON array of strings)
2b. ytdlp client                  per query: yt-dlp "ytsearchN:<query>" --dump-json --flat-playlist
                                  -> compact rows {title, channel, views, uploadDate, duration, url}
2c. Research Agent (unchanged system.js)
                                  prompt gains optional "REAL YOUTUBE DATA (via yt-dlp)" section
```

The scouted list is passed to `researchAgent(gemini, form, youtubeData)` and
released (`= null`) immediately after the research call returns, mirroring how
the research report itself is released after the Idea Agent.

## Components

### `src/agents/trendScout/` (new agent folder — follows the one-folder-per-agent convention)

- `system.js` — system message for the query planner. **This agent does not
  exist in the n8n workflow**, so the verbatim rule does not apply; the file
  carries a comment stating it is a Node-only addition, not an n8n port.
  Instructs the model: output ONLY a JSON array of 3-5 YouTube search query
  strings tuned for short-form content in the given niche/platform/audience.
- `prompt.js` — `buildTrendScoutPrompt(form)`: interpolates NICHE, PLATFORM,
  TARGET AUDIENCE, CONTENT STYLE into the planning request.
- `index.js` — `trendScoutAgent(gemini, form)`:
  1. `gemini.generate({ system, prompt, json: true })` -> array of queries
     (validated: array of non-empty strings, capped at 5).
  2. For each query, call the ytdlp client; concatenate results, cap the total
     (~50 videos).
  3. Return `{ queries, videos }` or `null` on any failure (see Failure
     handling).

### `src/clients/ytdlp.js` (new client)

- `searchYouTube(query, { limit, timeoutMs })`:
  - Spawns via `child_process.execFile` (argv array, **no shell** — the query
    string can contain anything without injection risk):
    `<YTDLP_PATH> ytsearch<limit>:<query> --dump-json --flat-playlist --no-warnings`
  - Parses stdout as NDJSON (one JSON object per line); tolerates bad lines.
  - Maps each entry to a compact row:
    `{ title, channel, view_count, upload_date, duration, url }` (fields may be
    null — flat extraction doesn't always populate all of them; keep nulls, do
    not fabricate).
  - Hard timeout (`YTDLP_TIMEOUT_MS`, default 60s per query) — kills the child
    process on expiry.
  - stderr logged at debug level only. No env secrets are passed beyond the
    default inherited environment; Gemini/Airtable/Telegram keys never appear
    in argv.

### `src/agents/research/prompt.js` (modified)

`buildResearchPrompt(form, youtubeData)` — new optional second param. When
`youtubeData?.videos?.length`, append a section:

```
REAL YOUTUBE DATA (via yt-dlp):
The following are actual current YouTube search results for this niche.
Ground your trend analysis in this data where relevant.

Query: <query 1>
- "<title>" — <channel>, <views> views, uploaded <date>, <duration>s
...
```

When `youtubeData` is absent/null, the returned prompt is **byte-identical to
today's output** — no behavioral change for existing callers
(`runPipeline.js`, recovery flows).

### `src/agents/research/index.js` (modified)

`researchAgent(gemini, form, youtubeData)` — passes `youtubeData` through to
the prompt builder. `system.js` is untouched (verbatim rule).

### `src/config.js` + `.env.example` (modified)

New `ytdlp` config block:

- `YTDLP_PATH` — binary path (default `yt-dlp`, resolved via PATH)
- `YTDLP_SEARCH_LIMIT` — results per query (default 15)
- `YTDLP_TIMEOUT_MS` — per-query timeout (default 60000)
- `TREND_SCOUT_ENABLED` — default on; `false` skips steps 2a/2b entirely

## Failure handling (degrade gracefully)

Every failure path results in `youtubeData = null` + a `logger.warn`, and the
pipeline continues to the Research Agent unchanged:

- yt-dlp binary missing (`ENOENT`)
- per-query timeout or non-zero exit
- YouTube blocking / empty results across all queries
- query-planner returns invalid JSON or an empty array

No Telegram error alert, no pipeline abort. A single query failing does not
abort the scout — remaining queries still run; only a fully-empty result set
degrades to null.

## Memory budget

- `--flat-playlist` metadata only: no video pages fetched per result, no
  downloads, no format resolution. ~50 compact rows is a few KB.
- `logger.mem('after:trendScout')` at the stage boundary (per convention).
- Scout output released after the research call, like the research report.

## Deployment

- **Render:** add yt-dlp to the build (either `pip install yt-dlp` in the
  build command, or download the standalone Linux binary during build and set
  `YTDLP_PATH`). If absent at runtime, the feature degrades silently.
- **Local (Windows):** `winget install yt-dlp` or `pip install yt-dlp`.

## Testing

No test suite exists in this repo. Verification:

1. `node --check` on every new/modified file.
2. One-shot `npm run pipeline` with the scout enabled: logs must show the
   planned queries, per-query video counts, `after:trendScout` memory
   snapshot, and a research report that references real scouted titles.
3. Degradation check: run with `YTDLP_PATH=definitely-missing` and confirm a
   warning is logged and the pipeline completes as before.

## Out of scope (YAGNI)

- Transcripts, comments, channel deep-dives (rejected in brainstorming; could
  be later extensions of the ytdlp client).
- Function-calling tool loop in `gemini.js`.
- Caching/persistence of scouted data (it is ephemeral prompt context only).
- TikTok/Instagram scraping — yt-dlp is used for YouTube search only.
