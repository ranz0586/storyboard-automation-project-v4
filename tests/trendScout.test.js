import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueries } from '../src/agents/trendScout/index.js';

test('accepts a plain array of query strings, trimmed', () => {
  assert.deepEqual(normalizeQueries(['  what if shorts ', 'space facts']), [
    'what if shorts',
    'space facts',
  ]);
});

test('unwraps a { queries: [...] } object (LLMs often wrap arrays)', () => {
  assert.deepEqual(normalizeQueries({ queries: ['a', 'b'] }), ['a', 'b']);
});

test('drops non-strings and empties, caps at 5', () => {
  const raw = ['q1', '', 42, null, 'q2', 'q3', 'q4', 'q5', 'q6'];
  assert.deepEqual(normalizeQueries(raw), ['q1', 'q2', 'q3', 'q4', 'q5']);
});

test('returns empty array for garbage input', () => {
  assert.deepEqual(normalizeQueries('not an array'), []);
  assert.deepEqual(normalizeQueries(null), []);
  assert.deepEqual(normalizeQueries({ nope: true }), []);
});
