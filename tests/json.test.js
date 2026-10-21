import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../src/utils/json.js';

const fence = String.fromCharCode(96).repeat(3);

test('valid JSON preserves Markdown fences inside string values', () => {
  for (const value of [
    { concepts: [{ review: { strategy_notes: 'Example: '+fence+'json {"example":true} '+fence } }] },
    [{ text: 'An unmatched '+fence+' is text too.' }],
    { text: 'Use '+fence+'json [1,2] '+fence+' literally.', nested: { quote: '"Keep this"', slash: '\\' } },
  ]) assert.deepEqual(extractJson(JSON.stringify(value)), value);
});

test('outer Markdown wrappers preserve embedded fences in JSON strings', () => {
  const value = { notes: 'Embedded '+fence+'json {"example":true} '+fence, keep: true };
  for (const label of ['json', 'JSON', '']) assert.deepEqual(extractJson(fence+label+'\n'+JSON.stringify(value,null,2)+'\n'+fence), value);
});

test('existing Markdown and prose recovery remains supported', () => {
  for (const text of [' '+fence+'json\n{"ok":true}\n'+fence+' ', 'Answer:\n{"ok":true}\nDone.', 'Notes [context]:\n'+fence+'json\n{"ok":true}\n'+fence+'\nDone.']) assert.deepEqual(extractJson(text), { ok: true });
  assert.deepEqual(extractJson('Answer: [1,2] Done.'), [1,2]);
});

test('already-parsed values and invalid JSON retain their existing behavior', () => {
  const object = { ok: true }; assert.equal(extractJson(object), object);
  for (const input of [null, undefined, '', 'not JSON', '{"bad":true,}', '{"bad":']) assert.throws(() => extractJson(input));
});
