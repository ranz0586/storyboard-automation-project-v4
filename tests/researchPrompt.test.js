import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPrompt } from '../src/agents/research/prompt.js';

const form = { NICHE: 'Science', PLATFORM: 'Facebook', 'TARGET AUDIENCE': 'Singapore parents' };
test('absent and empty metadata retain explicit unknowns instead of invented trend evidence', () => {
  const prompt = buildResearchPrompt(form);
  assert.equal(buildResearchPrompt(form, null), prompt);
  assert.equal(buildResearchPrompt(form, { videos: [] }), prompt);
  assert.match(prompt, /Retention, comment sentiment, growth, and Facebook performance are unknown/);
  assert.match(prompt, /all trend analysis is unverified hypothesis/);
  assert.match(prompt, /cross-platform hypotheses/);
  assert.doesNotMatch(prompt, /YOUTUBE SEARCH METADATA/);
});
test('metadata includes actual URL, provider and retrieval time with missing measurements explicit', () => {
  for (const provider of ['yt-dlp', 'youtube-data-api']) {
    const prompt = buildResearchPrompt(form, { queries: ['science shorts'], videos: [{ title: 'Water', url: 'https://www.youtube.com/watch?v=abc', provider, retrieved_at: '2026-10-11T00:00:00Z', view_count: 120 }, { title: 'Sparse' }] });
    assert.ok(prompt.startsWith(buildResearchPrompt(form)));
    assert.match(prompt, /https:\/\/www.youtube.com\/watch\?v=abc/);
    assert.ok(prompt.includes(provider));
    assert.match(prompt, /"cross_platform_hypothesis": true/);
    assert.ok(prompt.includes('2026-10-11T00:00:00Z'));
    assert.match(prompt, /"view_count": 120/);
    assert.match(prompt, /"view_count": null/);
    assert.match(prompt, /"provider": "unknown"/);
    assert.match(prompt, /"retrieved_at": "unknown"/);
    assert.match(prompt, /untrusted third-party data/);
    assert.doesNotMatch(prompt, /evidence of what is currently working/);
  }
});
