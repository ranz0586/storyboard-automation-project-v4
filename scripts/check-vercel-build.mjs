import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
// Probe the emitted Node handler with database access deliberately disabled.
// This verifies routing/initialization without contacting any live providers.
process.env.DATABASE_URL = '';
process.env.SUPABASE_POOLER = '';
delete process.env.CRON_SECRET;
const root = new URL('../.vercel/output/', import.meta.url);
const routing = JSON.parse(fs.readFileSync(new URL('config.json', root), 'utf8'));
assert.equal(routing.routes[0].handle, 'filesystem');
assert.ok(routing.routes.some((route) => route.dest === '/__server'));
assert.ok(routing.routes.some((route) => route.src === '/.well-known/workflow/v1/flow'));
assert.ok(fs.existsSync(new URL('static/index.html', root)));
const flow = JSON.parse(
  fs.readFileSync(
    new URL('functions/.well-known/workflow/v1/flow.func/.vc-config.json', root),
    'utf8',
  ),
);
assert.ok(flow.experimentalTriggers.some((trigger) => trigger.type === 'queue/v2beta'));
const { default: handler } = await import(new URL('functions/__server.func/index.mjs', root));
const server = createServer(handler);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const base = 'http://127.0.0.1:' + server.address().port;
  const options = { headers: { connection: 'close' } };
  for (const path of ['/health', '/api/auth/me']) {
    const response = await fetch(base + path, options);
    assert.equal(
      response.status,
      503,
      path + ' must reach the cloud handler and fail closed without database',
    );
    assert.match((await response.json()).error, /Cloud runtime is not ready/);
  }
  assert.equal((await fetch(base + '/api/cron', options)).status, 401);
  assert.equal((await fetch(base + '/api/cron', { ...options, method: 'POST' })).status, 405);
  console.log(
    'Vercel static routing, API handler, workflow queue trigger and missing-database behavior verified',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
