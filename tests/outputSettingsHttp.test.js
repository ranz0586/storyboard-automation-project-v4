import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { BriefStore } from '../src/briefs/briefStore.js';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { userClient, login } from './helpers/session.js';
import { createRateLimiter } from '../src/http/rateLimit.js';

async function fixture(work) {
  const local = new BriefStore(); let active = true;
  const asyncStore = Object.fromEntries(['get','defaults','set','freeze'].map(method => [method, async (...args) => local[method](...args)]));
  const client = userClient({ getProject: async id => ({ id, fields: { project_id: 'key-' + id, status: active ? 'Active' : 'Inactive' } }), listScriptsForProject: async () => ({ scripts: [{ id: 'recScript', fields: { video_id: 'video' } }], nextOffset: null }) }, ['recProject1']);
  const app = createApp({ makeAirtable: () => client, briefStore: asyncStore, runStore: new RunStore(), scheduleStore: new ScheduleStore(), rateLimiter: createRateLimiter({ limit: 1000 }), authOptions: { withLock: async (_key, work) => work() } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { const base = 'http://127.0.0.1:' + server.address().port; const headers = await login(base); await work({ base, headers, local, inactive: () => { active = false; } }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('output APIs await async storage, scope ownership, validate choices and keep existing snapshots immutable', () => fixture(async ({ base, headers, local, inactive }) => {
  const url = base + '/api/projects/recProject1/brief';
  const response = await fetch(url, { headers }); const initial = await response.json();
  assert.equal(response.status, 200); assert.equal(initial.guidancePacks.length, 4); assert.equal(initial.brief.structures.length, 3);
  const put = body => fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ structures: [] })).status, 400);
  assert.equal((await put({ structures: ['structure4'] })).status, 400);
  assert.equal((await put({ structures: ['structure2'], guidancePacks: [] })).status, 400);
  assert.equal((await put({ structures: ['structure2'] })).status, 200);
  assert.equal((await put({ language: 'English', durationSeconds: 30, characterReferences: 'Blue coat', styleReferences: 'Ink' })).status, 200);
  for (const invalid of [{ language: 'x'.repeat(101) }, { durationSeconds: 4 }, { durationSeconds: 301 }, { durationSeconds: 30.5 }, { workflow: 'music-video' }, { audio: 'silent' }, { entry: 'script' }, { styleReferences: 'x'.repeat(3001) }, { characterReferences: 'x'.repeat(3001) }]) assert.equal((await put(invalid)).status, 400);
  local.freeze('key-recProject1', 'video', { NICHE: 'Science' });
  assert.equal((await put({ structures: ['structure1'] })).status, 200);
  const after = await (await fetch(url, { headers })).json();
  assert.equal(after.brief.language, 'English'); assert.equal(after.brief.durationSeconds, 30);
  assert.equal(after.brief.characterReferences, 'Blue coat'); assert.equal(after.brief.styleReferences, 'Ink');
  const scripts = await (await fetch(base + '/api/projects/recProject1/scripts', { headers })).json();
  assert.deepEqual(scripts.scripts[0].productionBrief.structures, ['structure2']);
  assert.equal(scripts.scripts[0].productionBrief.language, 'English');
  assert.equal((await fetch(base + '/api/projects/recProject2/brief', { headers })).status, 404);
  assert.equal((await fetch(url)).status, 401);
  inactive(); assert.equal((await put({ structures: ['structure3'] })).status, 409);
}));
