import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createRateLimiter } from '../src/http/rateLimit.js';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { userClient, login } from './helpers/session.js';

const validBody = {
  NICHE: 'Science',
  PLATFORM: 'YouTube',
  'TARGET AUDIENCE': 'Adults',
  'CONTENT STYLE': 'Edutainment',
};

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

function testApp(overrides = {}) {
  const { makeAirtable = () => ({}), ...rest } = overrides;
  return createApp({
    authOptions: { secureCookies: false },
    makeGemini: () => ({}),
    makeAirtable: () => userClient(makeAirtable()),
    makeTelegram: () => ({}),
    rateLimiter: createRateLimiter({ limit: 100 }),
    runStore: new RunStore(), scheduleStore: new ScheduleStore(),
    ...rest,
  });
}

test('project API explicitly creates a retry-safe project using existing fields', async () => {
  const seen = [];
  const client = {
    createProject: async (fields) => {
      seen.push(fields);
      return { id: 'recProject1', fields, updated: seen.length > 1 };
    },
  };
  const app = testApp({ makeAirtable: () => client });
  const body = {
    requestId: '3f48ab7b-98ce-4f81-82c8-c820fedd3f50',
    name: 'Science Daily',
    niche: 'Science',
    platform: 'YouTube',
    targetAudience: 'Adults',
    contentStyle: 'Edutainment',
  };

  await withServer(app, async (base) => {
    const options = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...await login(base) },
      body: JSON.stringify(body),
    };
    assert.equal((await fetch(`${base}/api/projects`, options)).status, 201);
    assert.equal((await fetch(`${base}/api/projects`, options)).status, 200);
  });

  assert.equal(seen[0].project_id, `dashboard_recUser_${body.requestId}`);
  assert.deepEqual(seen[0].Users, ['recUser']);
  assert.equal(seen[0].channel_page_name, 'Science Daily');
  assert.equal(seen[0].target_audience, 'Adults');
  assert.equal(seen[0].has_style_reference, 'N');
});

test('project API uses custom project keys for statistics and record IDs for retrieval', async () => {
  const project = { id: 'recProject1', fields: { project_id: 'Science_YouTube', channel_page_name: 'Science Daily' } };
  const other = { id: 'recProject2', fields: { project_id: 'Parenting_Facebook', channel_page_name: 'Parenting' } };
  const requestedStats = [];
  const stats = {
    ideas: 4,
    scripts: 3,
    approvedScripts: 1,
    storyboards: 1,
    failedRecoveryItems: 1,
  };
  const client = {
    listProjectsForUser: async () => [project, other],
    getProject: async (id) => {
      assert.equal(id, project.id);
      return project;
    },
    projectStats: async (ids) => {
      requestedStats.push(ids);
      return { Science_YouTube: stats, Parenting_Facebook: { ...stats, ideas: 9 } };
    },
  };
  const app = testApp({ makeAirtable: () => client });

  await withServer(app, async (base) => {
    const headers = await login(base);
    const list = await fetch(`${base}/api/projects`, { headers });
    assert.equal(list.status, 200);
    const listed = (await list.json()).projects;
    assert.equal(listed[0].id, project.id);
    assert.deepEqual(listed[0].stats, stats);
    assert.equal(listed[1].stats.ideas, 9);

    const detail = await fetch(`${base}/api/projects/recProject1`, { headers });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).project.stats, stats);
  });
  assert.deepEqual(requestedStats, [['Science_YouTube', 'Parenting_Facebook'], ['Science_YouTube']]);
});

test('project API requires authentication', async () => {
  const app = testApp();
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  });
});

test('authenticated Airtable-backed reads are throttled separately from writes', async () => {
  let userReads = 0;
  const account = userClient();
  const client = {
    getUser: async () => { userReads++; return account.getUser(); },
    listProjectsForUser: async () => [],
    projectStats: async () => ({}),
  };
  const app = testApp({
    makeAirtable: () => client,
    readRateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
  });
  await withServer(app, async (base) => {
    const headers = await login(base);
    assert.equal((await fetch(`${base}/api/projects`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/projects`, { headers })).status, 429);
    assert.equal((await fetch(`${base}/api/projects`, { headers: { ...headers, 'X-Forwarded-For': '192.0.2.10' } })).status, 429);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 429);
    assert.equal(userReads, 1, 'rejected reads must not fetch the account, including session restoration');
  });
});

test('write throttling and same-origin checks precede Airtable authentication reads', async () => {
  let userReads = 0;
  const account = userClient();
  const app = testApp({ makeAirtable: () => ({
    getUser: async () => { userReads++; return account.getUser(); },
  }), rateLimiter: createRateLimiter({ limit: 1 }) });
  await withServer(app, async base => {
    const headers = { ...await login(base), 'content-type': 'application/json' };
    const options = { method: 'POST', headers, body: '{}' };
    assert.equal((await fetch(base + '/api/script-runs', options)).status, 400);
    assert.equal((await fetch(base + '/api/script-runs', options)).status, 429);
    assert.equal(userReads, 1);
    assert.equal((await fetch(base + '/api/script-runs', {
      ...options, headers: { cookie: headers.cookie, 'content-type': 'application/json' },
    })).status, 403);
    assert.equal(userReads, 1);
  });
});

test('script-run API creates a run and exposes status without a long request', async () => {
  const store = new RunStore();
  const existing = store.create({ projectId: 'recProject1', requestedCount: 2 });
  const controller = {
    create: (input) => store.create({
      projectId: input.projectId,
      requestedCount: input.count,
    }),
    retry: () => null,
  };
  const app = testApp({ runStore: store, scriptRunController: controller,
    makeAirtable: () => ({ getProject: async () => ({ id: 'recProject1', fields: {} }) }) });

  await withServer(app, async (base) => {
    const headers = { 'content-type': 'application/json', ...await login(base) };
    const created = await fetch(`${base}/api/script-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: 'recProject1', mode: 'count', count: 3 }),
    });
    assert.equal(created.status, 202);
    const { run } = await created.json();
    assert.equal(run.status, 'QUEUED');
    assert.equal(run.requestedCount, 3);

    const status = await fetch(`${base}/api/script-runs/${run.id}`, { headers });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).run.id, run.id);

    const list = await fetch(`${base}/api/script-runs?projectId=recProject1`, { headers });
    assert.ok((await list.json()).runs.some((item) => item.id === existing.id));
  });
});

test('schedule API validates and updates a project weekly schedule', async () => {
  const schedules = new ScheduleStore();
  const client = { getProject: async () => ({ id: 'recProject1', fields: {} }) };
  const app = testApp({ makeAirtable: () => client, scheduleStore: schedules });
  await withServer(app, async (base) => {
    const headers = { 'content-type': 'application/json', ...await login(base) };
    const invalid = await fetch(`${base}/api/projects/recProject1/schedule`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true, dayOfWeek: 8, time: '25:00', scriptCount: 0 }),
    });
    assert.equal(invalid.status, 400);

    const updated = await fetch(`${base}/api/projects/recProject1/schedule`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 10 }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).schedule.scriptCount, 10);

    const loaded = await fetch(`${base}/api/projects/recProject1/schedule`, {
      headers,
    });
    assert.equal((await loaded.json()).schedule.enabled, true);
  });
});


test('recovery API is scoped, bounded and uses the shared script controller', async () => {
  const calls = [];
  const client = { getProject: async id => ({ id, fields: { status: 'Active' } }) };
  const app = testApp({ makeAirtable: () => client,
    scriptRunController: { create: async (input, options) => {
      calls.push({ input, options }); return { id: 'recovery-run', ...input, source: options.source };
    } },
  });
  await withServer(app, async base => {
    const headers = { 'content-type': 'application/json', ...await login(base) };
    const post = (id, count) => fetch(base + '/api/projects/' + id + '/recovery-runs',
      { method: 'POST', headers, body: JSON.stringify({ count }) });
    assert.equal((await post('recOther', 1)).status, 404);
    assert.equal((await post('recProject1', 51)).status, 400);
    assert.equal(calls.length, 0);
    const response = await post('recProject1', 2);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).run.source, 'RECOVERY');
    assert.deepEqual(calls, [{ input: { projectId: 'recProject1', mode: 'count', count: 2 },
      options: { source: 'RECOVERY' } }]);
  });
});
