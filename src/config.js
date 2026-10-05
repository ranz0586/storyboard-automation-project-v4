import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) {
    // Do not throw at import time for every var — some flows only need a subset.
    // Callers that truly require a value should read config and validate.
    return '';
  }
  return v;
}

// GEMINI_API_KEYS is comma-separated; the legacy single GEMINI_API_KEY is
// merged in so existing .env files keep working. Order/duplicates don't matter
// (the pool dedupes and rotates by idle time).
function geminiApiKeys() {
  const keys = [
    ...(process.env.GEMINI_API_KEYS || '').split(','),
    process.env.GEMINI_API_KEY || '',
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

export const config = {
  gemini: {
    apiKeys: geminiApiKeys(),
    // Per-key cooldown between uses (default 5 min). Set 0 to disable.
    keyCooldownMs: process.env.GEMINI_KEY_COOLDOWN_MS !== undefined
      ? Number(process.env.GEMINI_KEY_COOLDOWN_MS)
      : 5 * 60_000,
    modelPrimary: process.env.GEMINI_MODEL_PRIMARY || 'gemini-3.8-flash',
    modelFallback: process.env.GEMINI_MODEL_FALLBACK || 'gemini-3.5-flash-lite',
  },
  // yt-dlp Trend Scout (Node-only addition; not part of the n8n workflow).
  ytdlp: {
    path: process.env.YTDLP_PATH || 'yt-dlp',
    provider: process.env.YOUTUBE_PROVIDER || (process.env.VERCEL || process.env.CLOUD_RUNTIME === 'true' ? 'api' : 'yt-dlp'),
    searchLimit: Number(process.env.YTDLP_SEARCH_LIMIT) || 15,
    timeoutMs: Number(process.env.YTDLP_TIMEOUT_MS) || 60_000,
    // Default on; set TREND_SCOUT_ENABLED=false to skip the scout entirely.
    enabled: process.env.TREND_SCOUT_ENABLED !== 'false',
  },
  airtable: {
    apiKey: required('AIRTABLE_API_KEY'),
    // typecast lets Airtable coerce near-miss values (numeric strings into
    // number columns, new singleSelect options) instead of rejecting the
    // whole record. Set AIRTABLE_TYPECAST=false to disable.
    typecast: process.env.AIRTABLE_TYPECAST !== 'false',
    // The live Ideas title has a BOM; Scripts and Storyboard identity columns
    // currently have plain names. Per-field overrides accommodate schema edits.
    identityFieldsHaveBom: {
      ideas: process.env.AIRTABLE_IDEA_TITLE_HAS_BOM !== undefined
        ? process.env.AIRTABLE_IDEA_TITLE_HAS_BOM !== 'false'
        : process.env.AIRTABLE_IDENTITY_FIELDS_HAVE_BOM !== 'false',
      scripts: process.env.AIRTABLE_SCRIPT_VIDEO_ID_HAS_BOM !== undefined
        ? process.env.AIRTABLE_SCRIPT_VIDEO_ID_HAS_BOM !== 'false'
        : process.env.AIRTABLE_IDENTITY_FIELDS_HAVE_BOM === 'true',
      storyboards: process.env.AIRTABLE_STORYBOARD_ID_HAS_BOM !== undefined
        ? process.env.AIRTABLE_STORYBOARD_ID_HAS_BOM !== 'false'
        : process.env.AIRTABLE_IDENTITY_FIELDS_HAVE_BOM === 'true',
    },
    baseId: process.env.AIRTABLE_BASE_ID || 'appnBhwjEiHrAZpaa',
    tables: {
      projects: process.env.AIRTABLE_TABLE_PROJECTS || 'Projects',
      ideas: process.env.AIRTABLE_TABLE_IDEAS || 'Ideas',
      scripts: process.env.AIRTABLE_TABLE_SCRIPTS || 'Scripts',
      storyboards: process.env.AIRTABLE_TABLE_STORYBOARDS || 'Storyboard',
      users: process.env.AIRTABLE_TABLE_USERS || 'Users',
    },
  },
  telegram: {
    botToken: required('TELEGRAM_BOT_TOKEN'),
    chatId: process.env.TELEGRAM_CHAT_ID || '6626378722',
  },
  server: {
    port: Number(process.env.PORT || 3000),
    sessionTtlMs: Number(process.env.SESSION_TTL_MS) || 8 * 60 * 60_000,
    secureCookies: process.env.SESSION_COOKIE_SECURE !== undefined
      ? process.env.SESSION_COOKIE_SECURE !== 'false' : process.env.NODE_ENV === 'production',
    rateLimitMax: Number(process.env.PIPELINE_RATE_LIMIT_MAX || 5),
    rateLimitWindowMs: Number(process.env.PIPELINE_RATE_LIMIT_WINDOW_MS || 60_000),
    readRateLimitMax: Number(process.env.API_READ_RATE_LIMIT_MAX || 120),
    maxConcurrentPipelines: Number(process.env.PIPELINE_MAX_CONCURRENCY || 1),
    maxQueuedPipelines: Number(process.env.PIPELINE_MAX_QUEUED || 10),
  },
  pipeline: {
    conceptCount: Number(process.env.IDEA_CONCEPT_COUNT || 10),
    // In-process storyboard poll interval (replaces the n8n Schedule Trigger,
    // 15 min there). 0/unset = off; use `npm run storyboard` + cron instead.
    storyboardPollMs: Number(process.env.STORYBOARD_POLL_MS || 0),
  },
  scheduler: {
    pollMs: Number(process.env.SCHEDULER_POLL_MS || 60_000),
    timeZone: process.env.SCHEDULE_TIMEZONE || 'Asia/Singapore',
    statePath: process.env.SCHEDULE_STATE_PATH || 'data/schedules.json',
    runStatePath: process.env.RUN_STATE_PATH || 'data/runs.json',
  },
  locks: {
    scriptDir: process.env.SCRIPT_LOCK_DIR || 'data/script-locks',
    userDir: process.env.USER_LOCK_DIR || 'data/user-locks',
  },
};
