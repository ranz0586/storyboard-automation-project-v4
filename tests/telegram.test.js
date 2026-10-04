import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../src/clients/telegram.js';

test('error alerts send provider messages as plain text', async () => {
  let payload;
  const client = new TelegramClient({
    botToken: 'test-token',
    chatId: 'test-chat',
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true };
    },
  });
  const sent = await client.errorAlert({
    workflowName: 'Script Pipeline Run',
    nodeName: 'idea_123',
    message: 'Model returned [503] with underscore_name',
  });
  assert.equal(sent, true);
  assert.equal(payload.parse_mode, undefined);
  assert.match(payload.text, /underscore_name/);
});
