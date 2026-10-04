# Task 4: Research prompt gains the optional YouTube data section — TDD Report

**Status:** DONE  
**Date:** 2026-08-03

## Summary

Successfully implemented optional YouTube data integration into the Research Agent's user prompt following strict TDD methodology. All tests pass (10/10), backward compatibility preserved (byte-identical output when data absent), and hard constraints respected (system.js untouched).

## TDD Evidence

### Step 1: RED (Test Created)
Created `tests/researchPrompt.test.js` with two test cases:
1. Backward compatibility test: verifies output is unchanged when youtubeData is null, undefined, or empty
2. YouTube data section test: verifies the prompt appends formatted video data when provided

### Step 2: Initial Test Run (RED)
```
✖ with youtubeData the prompt appends the data section listing rows
  AssertionError: The expression evaluated to a falsy value:
  assert.ok(p.includes('REAL YOUTUBE DATA (via yt-dlp)'))
```

**Result:** 1 PASS (backward compatibility test), 1 FAIL (YouTube data section test) ✓ Expected RED state

### Step 3: Implementation
Replaced `src/agents/research/prompt.js` with new implementation:
- Wrapped base template in `buildResearchPrompt(form, youtubeData)` function
- Added `formatVideoLine(v)` to compact video row formatting (null fields omitted entirely)
- Added `formatYoutubeData()` to format the YouTube data section
- Preserved base template character-for-character (byte-identical when youtubeData absent)

### Step 4: Final Test Run (GREEN)
```
✔ without youtubeData the prompt is unchanged (no data section, backward compatible) (2.5648ms)
✔ with youtubeData the prompt appends the data section listing rows (0.9195ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

**Result:** 2 PASS ✓ Expected GREEN state

### Step 5: Updated Agent Index
Replaced `src/agents/research/index.js`:
- Added optional `youtubeData = null` parameter to `researchAgent()`
- Passes youtubeData through to `buildResearchPrompt()`
- Maintains backward compatibility for existing callers (two-argument calls)

### Step 6: Full Suite Verification
```
✔ without youtubeData the prompt is unchanged (backward compatible)
✔ with youtubeData the prompt appends the data section listing rows
✔ accepts a plain array of query strings, trimmed (ytdlp tests)
✔ unwraps a { queries: [...] } object (ytdlp tests)
✔ drops non-strings and empties, caps at 5 (trendScout tests)
✔ returns empty array for garbage input (trendScout tests)
✔ parses one video row per NDJSON line (trendScout tests)
✔ tolerates blank and malformed lines (trendScout tests)
✔ falls back to webpage_url and uploader (trendScout tests)
✔ returns empty array for empty stdout (trendScout tests)

ℹ tests 10
ℹ pass 10
ℹ fail 0
```

**Result:** All 10 tests pass (2 new + 4 ytdlp + 4 trendScout) ✓

## Hard Constraints Verification

✅ **system.js unchanged** — `src/agents/research/system.js` not modified (verified via syntax check)
✅ **Backward compatibility** — Base template preserved character-for-character; absent youtubeData produces identical output
✅ **YouTube data formatting** — Null fields omitted entirely (never "null" printed); video rows formatted as: `"Title" — Channel, N views, uploaded DATE, Ds`
✅ **Function signatures** — `buildResearchPrompt(form, youtubeData?)` and `researchAgent(gemini, form, youtubeData? = null)` both optional third params
✅ **ESM/No new deps** — Pure JavaScript, no new dependencies added
✅ **Syntax validation** — `node --check` passed for both modified files

## Files Changed

- ✏️ **Created:** `tests/researchPrompt.test.js` (66 lines, 2 test cases)
- ✏️ **Modified:** `src/agents/research/prompt.js` (60 lines, now exports `buildResearchPrompt` function with optional youtubeData param)
- ✏️ **Modified:** `src/agents/research/index.js` (13 lines, added optional youtubeData param to `researchAgent`)
- 🚫 **Untouched:** `src/agents/research/system.js` (hard rule preserved)

## Key Implementation Details

### Backward Compatibility Pattern
```js
if (!youtubeData?.videos?.length) return base;
return base + formatYoutubeData(youtubeData);
```
- Returns base prompt unmodified when youtubeData is null, undefined, or has no videos
- Ensures byte-identical output for absent data (critical constraint)

### Video Formatting
```js
const parts = [`"${v.title ?? 'Untitled'}"`];
const meta = [
  v.channel,
  v.view_count != null ? `${v.view_count} views` : null,
  v.upload_date ? `uploaded ${v.upload_date}` : null,
  v.duration != null ? `${v.duration}s` : null,
].filter((x) => x != null);
```
- Null fields filtered entirely (never prints "null")
- Handles missing title gracefully ("Untitled" fallback)
- Compact format: `"Title" — Channel, 1234567 views, uploaded 20260715, 42s`

### Data Section Header
```
REAL YOUTUBE DATA (via yt-dlp):
The following are actual current YouTube search results for this niche (queries: what if shorts).
Ground your trend analysis in this real data where relevant — treat titles, view counts, and upload dates as evidence of what is currently working.
```
- Frames YouTube data as evidence for research context
- Lists queries used for retrieval
- Followed by video rows (one per line)

## Test Coverage

The two new tests verify:
1. **Backward compatibility** (3 assertions each):
   - Base prompt contains no YouTube section
   - null/undefined/empty youtubeData all produce identical output
   
2. **YouTube data integration** (6 assertions):
   - Prompt starts with base template (strict prefix)
   - REAL YOUTUBE DATA section present
   - Query terms included
   - Full video row formatted correctly (channel, view count, date, duration)
   - Sparse rows handled (null fields omitted)
   - No "null" strings in output

## Relationship to Previous Tasks

- **Task 1:** Config infrastructure (used for GEMINI, AIRTABLE env vars)
- **Task 2:** ytdlp client (provides raw video data)
- **Task 3:** trendScout agent (transforms yt-dlp data into {queries, videos} shape)
- **Task 4:** Research prompt integration (threads YouTube data into Research Agent's context)

Pipeline flow: `POST /niche -> [Research + Youtube Data] -> Idea Agent -> Scripts`

## No Open Issues

All hard rules respected, all tests passing, backward compatibility verified, code style consistent with existing agents.
