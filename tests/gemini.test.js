import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiClient, generateWithServerRetry } from '../src/clients/gemini.js';

function clientFixture(generate, size = 2) {
  const calls = [], acquisitions = [];
  const client = new GeminiClient({ apiKeys: ['test-only'], primary: 'primary', fallback: 'fallback',
    keyPool: { size, acquire: async () => {
      const index = acquisitions.length % size; acquisitions.push(index); return { key: `test-key-${index}`, index };
    } },
    modelFactory: options => ({ generateContent: async prompt => {
      calls.push({ ...options, prompt });
      const output = await generate(options, calls.length);
      return { response: { text: () => output } };
    } }), retryOptions: { wait: async () => {}, random: () => 0 } });
  return { client, calls, acquisitions };
}

test('full client uses the primary and parses structured JSON without fallback', async () => {
  const { client, calls, acquisitions } = clientFixture(async () => '{"ok":true}');
  assert.deepEqual(await client.generate({ system: 'rules', prompt: 'input', json: true }), { ok: true });
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'primary');
  assert.equal(calls[0].system, 'rules'); assert.equal(calls[0].json, true);
  assert.equal(acquisitions.length, 1);
});

test('full client exhausts primary 503 retries then succeeds on fallback with the same key', async () => {
  const { client, calls, acquisitions } = clientFixture(async ({ name }) => {
    if (name === 'primary') throw Object.assign(new Error('Unavailable'), { status: 503 });
    return 'fallback result';
  });
  assert.equal(await client.generate({ prompt: 'input' }), 'fallback result');
  assert.deepEqual(calls.map(call => call.name), ['primary', 'primary', 'primary', 'fallback']);
  assert.equal(new Set(calls.map(call => call.apiKey)).size, 1);
  assert.equal(acquisitions.length, 1);
});

test('full client rotates quota failures through one key lap without retrying 429 in place', async () => {
  const { client, calls, acquisitions } = clientFixture(async () => {
    throw Object.assign(new Error('Rate limited'), { status: 429 });
  });
  await assert.rejects(client.generate({ prompt: 'input' }), /Rate limited/);
  assert.equal(calls.length, 4); assert.deepEqual(acquisitions, [0, 1]);
  assert.deepEqual(calls.map(call => call.name), ['primary', 'fallback', 'primary', 'fallback']);
});

test('full client can recover on another key and stops non-quota errors after fallback', async () => {
  const rotated = clientFixture(async ({ apiKey }) => {
    if (apiKey === 'test-key-0') throw Object.assign(new Error('Quota'), { status: 429 });
    return 'ok';
  });
  assert.equal(await rotated.client.generate({ prompt: 'input' }), 'ok');
  assert.equal(rotated.calls.length, 3);
  const invalid = clientFixture(async () => { throw Object.assign(new Error('Model missing'), { status: 404 }); });
  await assert.rejects(invalid.client.generate({ prompt: 'input' }), /Model missing/);
  assert.equal(invalid.calls.length, 2); assert.equal(invalid.acquisitions.length, 1);
});

test('full client falls back on malformed JSON and rejects empty output without cycling keys', async () => {
  const fixture = clientFixture(async ({ name }) => name === 'primary' ? 'not-json' : '{"repaired":true}');
  assert.deepEqual(await fixture.client.generate({ prompt: 'input', json: true }), { repaired: true });
  assert.equal(fixture.calls.length, 2);
  const empty = clientFixture(async () => '');
  await assert.rejects(empty.client.generate({ prompt: 'input', json: true }));
  assert.equal(empty.calls.length, 2); assert.equal(empty.acquisitions.length, 1);
});

test('retries a transient 503 with bounded backoff', async () => {
  let attempts = 0;
  const waits = [];
  const model = { generateContent: async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error('Service Unavailable'), { status: 503 });
    return { response: { text: () => 'ok' } };
  } };
  const result = await generateWithServerRetry(model, 'prompt', {
    wait: async (ms) => { waits.push(ms); }, random: () => 0,
  });
  assert.equal(result.response.text(), 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1_000, 2_000]);
});

test('stops after two retries when the model stays unavailable', async () => {
  let attempts = 0;
  const model = { generateContent: async () => {
    attempts++;
    throw new Error('[503 Service Unavailable]');
  } };
  await assert.rejects(generateWithServerRetry(model, 'prompt', {
    wait: async () => {}, random: () => 0,
  }), /503/);
  assert.equal(attempts, 3);
});

test('does not retry quota or invalid-request errors', async () => {
  for (const status of [429, 400]) {
    let attempts = 0;
    const model = { generateContent: async () => {
      attempts++;
      throw Object.assign(new Error(`HTTP ${status}`), { status });
    } };
    await assert.rejects(generateWithServerRetry(model, 'prompt', { wait: async () => {} }));
    assert.equal(attempts, 1);
  }
});
