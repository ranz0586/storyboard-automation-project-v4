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
export async function trendScoutAgent(gemini, form, { search = searchYouTube } = {}) {
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
    if (err?.code === 'DEFERRED') throw err;
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
      const rows = await search(query);
      videos.push(...rows.slice(0, MAX_TOTAL_VIDEOS - videos.length));
      logger.info(`Trend Scout "${query}": ${rows.length} videos`);
    } catch (err) {
    if (err?.code === 'DEFERRED') throw err;
      logger.warn(`Trend Scout metadata search failed for "${query}"`, err?.message);
    }
  }

  if (!videos.length) {
    logger.warn('Trend Scout found no videos — continuing without YouTube data');
    return null;
  }
  return { queries, videos };
}
