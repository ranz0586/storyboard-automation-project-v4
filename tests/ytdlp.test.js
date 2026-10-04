import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNdjsonVideos } from '../src/clients/ytdlp.js';

test('parses one video row per NDJSON line, keeping nulls for missing fields', () => {
  const stdout = [
    JSON.stringify({
      title: 'What If Earth Stopped',
      channel: 'WhatIfChannel',
      view_count: 1234567,
      upload_date: '20260715',
      duration: 42,
      url: 'https://www.youtube.com/watch?v=abc123',
    }),
    JSON.stringify({ title: 'No stats video' }), // flat extraction often omits fields
  ].join('\n');

  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    title: 'What If Earth Stopped',
    channel: 'WhatIfChannel',
    view_count: 1234567,
    upload_date: '20260715',
    duration: 42,
    url: 'https://www.youtube.com/watch?v=abc123',
  });
  assert.deepEqual(rows[1], {
    title: 'No stats video',
    channel: null,
    view_count: null,
    upload_date: null,
    duration: null,
    url: null,
  });
});

test('tolerates blank and malformed lines', () => {
  const stdout = '\n{"title":"ok"}\nnot json at all\n\n{"title":"ok2"}\n';
  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'ok');
  assert.equal(rows[1].title, 'ok2');
});

test('falls back to webpage_url and uploader when url/channel missing', () => {
  const stdout = JSON.stringify({
    title: 't',
    uploader: 'SomeUploader',
    webpage_url: 'https://www.youtube.com/watch?v=xyz',
  });
  const rows = parseNdjsonVideos(stdout);
  assert.equal(rows[0].channel, 'SomeUploader');
  assert.equal(rows[0].url, 'https://www.youtube.com/watch?v=xyz');
});

test('returns empty array for empty stdout', () => {
  assert.deepEqual(parseNdjsonVideos(''), []);
});
