// Search metadata only; no downloads or local binary. API credentials stay server-side.
export async function searchYouTubeApi(
  query,
  { limit = 15, timeoutMs = 60000, apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = fetch } = {},
) {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for YouTube metadata');
  const get = async (resource, params) => {
    const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error('YouTube metadata request failed');
    }
    if (!response.ok) throw new Error('YouTube metadata service returned HTTP ' + response.status);
    return response.json();
  };
  const found = await get('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: String(Math.max(1, Math.min(50, limit))),
  });
  const entries = (found.items || []).filter((item) => item.id?.videoId);
  if (!entries.length) return [];
  const details = await get('videos', {
    part: 'snippet,contentDetails,statistics',
    id: entries.map((item) => item.id.videoId).join(','),
  });
  const rows = new Map((details.items || []).map((item) => [item.id, item]));
  return entries.map((entry) => {
    const data = rows.get(entry.id.videoId),
      snippet = data?.snippet || entry.snippet || {};
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
      data?.contentDetails?.duration || '',
    );
    return {
      title: snippet.title ?? null,
      channel: snippet.channelTitle ?? null,
      view_count:
        data?.statistics?.viewCount !== undefined ? Number(data.statistics.viewCount) : null,
      upload_date: snippet.publishedAt
        ? snippet.publishedAt.slice(0, 10).replaceAll('-', '')
        : null,
      duration: match
        ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
        : null,
      url: 'https://www.youtube.com/watch?v=' + entry.id.videoId,
    };
  });
}
