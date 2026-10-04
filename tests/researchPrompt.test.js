import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPrompt } from '../src/agents/research/prompt.js';

const form = {
  NICHE: 'What If',
  PLATFORM: 'Facebook',
  'TARGET AUDIENCE': 'US',
  'CONTENT STYLE': 'Edutainment',
  'CHANNEL DESCRIPTION (Optional)': 'What If FIFA, grounded physics',
};

test('without youtubeData the prompt is unchanged (no data section, backward compatible)', () => {
  const base = buildResearchPrompt(form);
  assert.ok(!base.includes('REAL YOUTUBE DATA'));
  // Absent and empty youtubeData produce the identical prompt.
  assert.equal(buildResearchPrompt(form, null), base);
  assert.equal(buildResearchPrompt(form, undefined), base);
  assert.equal(buildResearchPrompt(form, { queries: [], videos: [] }), base);
});

test('with youtubeData the prompt appends the data section listing rows', () => {
  const youtubeData = {
    queries: ['what if shorts'],
    videos: [
      {
        title: 'What If Earth Stopped',
        channel: 'WhatIfChannel',
        view_count: 1234567,
        upload_date: '20260715',
        duration: 42,
        url: 'https://www.youtube.com/watch?v=abc123',
      },
      { title: 'Sparse row', channel: null, view_count: null, upload_date: null, duration: null, url: null },
    ],
  };
  const p = buildResearchPrompt(form, youtubeData);
  assert.ok(p.startsWith(buildResearchPrompt(form))); // base prompt is a strict prefix
  assert.ok(p.includes('REAL YOUTUBE DATA (via yt-dlp)'));
  assert.ok(p.includes('what if shorts'));
  assert.ok(p.includes('"What If Earth Stopped" — WhatIfChannel, 1234567 views, uploaded 20260715, 42s'));
  assert.ok(p.includes('"Sparse row"')); // null fields are simply omitted, not printed as "null"
  assert.ok(!p.includes('null'));
});
