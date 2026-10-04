import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { createRateLimiter } from '../src/http/rateLimit.js';
import { ScriptRunController } from '../src/runs/scriptRunController.js';
import { IdeaRunController } from '../src/runs/ideaRunController.js';
import { RunStore } from '../src/runs/runStore.js';
import { userClient, login } from './helpers/session.js';

async function serverTest(client, fn, extra = {}) {
  const app = createApp({ authOptions: { secureCookies: false }, makeAirtable: () => userClient(client), runStore: new RunStore(),
    scheduleStore: new ScheduleStore(), rateLimiter: createRateLimiter({ limit: 100 }), ...extra });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionHeaders = await login(base);
  const call = (path, method = 'GET', body, auth = true) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? sessionHeaders : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try { await fn(call); } finally { await new Promise(resolve => server.close(resolve)); }
}

function fixture() {
  const project = { id: 'recProject', fields: { project_id: 'Parenting_Facebook', status: 'Active' } };
  const script = { id: 'recScript', fields: { Projects: 'Parenting_Facebook', status: 'Draft', video_id: 'video1',
    title: 'Review me', voiceover_script: 'Usable narration', estimated_duration_seconds: 30,
    scenes_json: JSON.stringify([{ scene_number: 1, duration_seconds: 30 }]) } };
  const writes = [];
  const client = {
    getProject: async () => structuredClone(project),
    getScript: async () => structuredClone(script),
    updateScript: async (id, fields) => { writes.push({ id, fields }); Object.assign(script.fields, fields); return structuredClone(script); },
    updateProjectStatus: async (id, status) => { writes.push({ id, status }); project.fields.status = status; return structuredClone(project); },
  };
  return { project, script, writes, client };
}

test('approval authenticates, validates the script, persists once, and never downgrades completed work', async () => {
  const fx = fixture();
  const path = '/api/projects/recProject/scripts/recScript/approve';
  await serverTest(fx.client, async call => {
    assert.equal((await call(path, 'POST', undefined, false)).status, 401);
    assert.equal(fx.writes.length, 0);
    const approved = await call(path, 'POST');
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).script.fields.status, 'Approved');
    assert.equal((await call(path, 'POST')).status, 200);
    assert.equal(fx.writes.length, 1);
    fx.script.fields.status = 'Story Generated';
    const completed = await call(path, 'POST');
    assert.equal((await completed.json()).script.fields.status, 'Story Generated');
    assert.equal(fx.writes.length, 1);
  });
});

test('approval rejects other projects, incomplete scripts, inactive projects and upstream failures', async () => {
  const fx = fixture();
  const path = '/api/projects/recProject/scripts/recScript/approve';
  await serverTest(fx.client, async call => {
    fx.script.fields.Projects = 'Other_Project';
    assert.equal((await call(path, 'POST')).status, 404);
    fx.script.fields.Projects = 'Parenting_Facebook';
    fx.script.fields.voiceover_script = '';
    assert.equal((await call(path, 'POST')).status, 409);
    fx.script.fields.voiceover_script = 'Narration';
    fx.project.fields.status = 'Inactive';
    assert.equal((await call(path, 'POST')).status, 409);
    fx.project.fields.status = 'Active';
    fx.client.updateScript = async () => { throw new Error('Upstream failed'); };
    assert.equal((await call(path, 'POST')).status, 503);
    assert.equal(fx.writes.length, 0);
    assert.equal(fx.script.fields.status, 'Draft');
  });
});

test('approval reports a missing Airtable choice clearly', async () => {
  const fx = fixture();
  fx.client.updateScript = async () => {
    throw Object.assign(new Error('Unknown choice'), { statusCode: 422, error: 'INVALID_MULTIPLE_CHOICE_OPTIONS' });
  };
  await serverTest(fx.client, async call => {
    const response = await call('/api/projects/recProject/scripts/recScript/approve', 'POST');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Approved choice/);
  });
});

test('project statuses validate input, disable recurrence, block work, and allow reactivation', async () => {
  const fx = fixture();
  const schedules = new ScheduleStore();
  schedules.set('recProject', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 2 });
  let starts = 0;
  const controller = { create: () => { starts++; return { id: 'run' }; } };
  await serverTest(fx.client, async call => {
    const path = '/api/projects/recProject/status';
    assert.equal((await call(path, 'PATCH', { status: 'Inactive' }, false)).status, 401);
    assert.equal((await call(path, 'PATCH', { status: 'Deleted' })).status, 400);
    assert.equal((await call(path, 'PATCH', { status: 'Inactive' })).status, 200);
    assert.equal(schedules.get('recProject').enabled, false);
    const run = { projectId: 'recProject', mode: 'count', count: 1 };
    assert.equal((await call('/api/script-runs', 'POST', run)).status, 409);
    assert.equal((await call('/api/projects/recProject/idea-runs', 'POST', { count: 1 })).status, 409);
    assert.equal((await call('/api/projects/recProject/schedule', 'PUT', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 1 })).status, 409);
    assert.equal(starts, 0);
    assert.equal((await call(path, 'PATCH', { status: 'Archived' })).status, 400);
    assert.equal((await call('/api/script-runs', 'POST', run)).status, 409);
    assert.equal((await call(path, 'PATCH', { status: 'Active' })).status, 200);
    assert.equal(schedules.get('recProject').enabled, false);
    assert.equal((await call('/api/script-runs', 'POST', run)).status, 202);
    assert.equal(starts, 1);
  }, { scheduleStore: schedules, scriptRunController: controller, ideaRunController: controller });
});

test('script pages validate cursor input, require auth, and return bounded pagination', async () => {
  const fx = fixture();
  const calls = [];
  fx.client.listScriptsForProject = async (id, options) => {
    calls.push({ id, options }); return { scripts: [fx.script], nextOffset: 'next-page' };
  };
  await serverTest(fx.client, async call => {
    const path = '/api/projects/recProject/scripts';
    assert.equal((await call(path, 'GET', undefined, false)).status, 401);
    assert.equal((await call(`${path}?limit=1000`)).status, 400);
    const response = await call(`${path}?limit=10&offset=page-two`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).nextOffset, 'next-page');
    assert.deepEqual(calls, [{ id: 'recProject', options: { limit: 10, offset: 'page-two' } }]);
  });
});

test('queued script and idea work rechecks project status before initializing Gemini', async () => {
  for (const Controller of [ScriptRunController, IdeaRunController]) {
    const store = new RunStore();
    let task, geminiCalls = 0;
    const controller = new Controller({ store, queue: { canAccept: true, tryEnqueue: fn => { task = fn; return true; } },
      makeAirtable: () => ({ getProject: async () => ({ id: 'recProject', fields: { status: 'Inactive' } }) }),
      makeGemini: () => { geminiCalls++; throw new Error('Should not initialize'); },
      makeTelegram: () => ({ errorAlert: async () => {} }),
    });
    const run = controller.create({ projectId: 'recProject', mode: 'count', count: 1 });
    await task();
    assert.equal(geminiCalls, 0);
    assert.equal(store.get(run.id).status, 'FAILED');
    assert.match(store.get(run.id).error, /inactive/);
  }
});
