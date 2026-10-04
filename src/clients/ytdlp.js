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
