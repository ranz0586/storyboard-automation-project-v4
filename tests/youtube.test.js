import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchYouTubeApi } from '../src/clients/youtube.js';
import { trendScoutAgent } from '../src/agents/trendScout/index.js';
import { DeferredError } from '../src/cloud/coordination.js';
test('YouTube API returns the existing compact search metadata contract', async () => {
  const calls = [];
  const result = await searchYouTubeApi('parenting', {
    apiKey: 'test-only-key',
    limit: 99,
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () =>
          url.pathname.endsWith('/search')
            ? { items: [{ id: { videoId: 'abc' }, snippet: { title: 'fallback' } }] }
            : {
                items: [
                  {
                    id: 'abc',
                    snippet: {
                      title: 'Parenting',
                      channelTitle: 'Channel',
                      publishedAt: '2026-09-01T12:00:00Z',
                    },
                    statistics: { viewCount: '120' },
                    contentDetails: { duration: 'PT1H2M3S' },
                  },
                ],
              },
      };
    },
  });
  assert.equal(calls[0].searchParams.get('maxResults'), '50');
  assert.deepEqual(result, [
    {
      title: 'Parenting',
      channel: 'Channel',
      view_count: 120,
      upload_date: '20260901',
      duration: 3723,
      url: 'https://www.youtube.com/watch?v=abc',
    },
  ]);
});
test('YouTube failures do not expose API credentials and missing metadata stays unknown', async () => {
  await assert.rejects(
    searchYouTubeApi('x', {
      apiKey: 'secret-value',
      fetchImpl: async () => {
        throw new Error('secret-value');
      },
    }),
    (e) => !e.message.includes('secret-value'),
  );
  await assert.rejects(
    searchYouTubeApi('x', {
      apiKey: 'secret-value',
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }),
    /HTTP 403/,
  );
  let n = 0;
  const result = await searchYouTubeApi('x', {
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => (++n === 1 ? { items: [{ id: { videoId: 'a' } }] } : { items: [] }),
    }),
  });
  assert.equal(result[0].view_count, null);
  assert.equal(result[0].duration, null);
});
test('Trend Scout propagates durable cooldowns instead of silently losing grounding', async () => {
  await assert.rejects(
    trendScoutAgent(
      {
        generate: async () => {
          throw new DeferredError('cooldown', Date.now() + 60000);
        },
      },
      { NICHE: 'test' },
    ),
    (e) => e.code === 'DEFERRED',
  );
});
