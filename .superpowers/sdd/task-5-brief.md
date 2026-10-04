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


**Project context:** D:\n8n-automation-project — ESM Node.js (>=20) service. NOT a git repository: no git commands, no commits. Test runner: `node --test tests/`.

**Global constraints that bind this task:**
- Preserve the memory-conscious design of pipeline.js: scripts one concept at a time; large intermediates released when no longer needed. The step-2 replacement above implements exactly that for the scout output (`youtubeData = null` after research).
- `logger.mem(label)` at stage boundaries — the replacement block includes them; do not remove existing ones.
- Do not change `runContentPipeline`'s signature, return value, or any other stage.
- No new npm dependencies.
