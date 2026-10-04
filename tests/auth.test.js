import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { createRateLimiter } from '../src/http/rateLimit.js';
import { hashPassword, verifyPassword } from '../src/http/passwords.js';
import { login, testPassword, userClient } from './helpers/session.js';

async function withServer(client, work, overrides = {}) {
  const lockDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-users-'));
  const app = createApp({ makeAirtable: () => client, runStore: new RunStore(), scheduleStore: new ScheduleStore(),
    authOptions: { secureCookies: false, lockDir, ...overrides.authOptions }, ...overrides });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await work(`http://127.0.0.1:${server.address().port}`, app); }
  finally { await new Promise(resolve => server.close(resolve)); await fs.rmdir(lockDir); }
}
const post = (base, route, body, headers = {}) => fetch(base + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('passwords use random salted hashes and reject wrong, malformed, and plaintext values', async () => {
  const first = await hashPassword(testPassword), second = await hashPassword(testPassword);
  assert.notEqual(first, second);
  assert.equal(first.includes(testPassword), false);
  assert.equal(await verifyPassword(testPassword, first), true);
  assert.equal(await verifyPassword('incorrect', first), false);
  assert.equal(await verifyPassword(testPassword, testPassword), false);
  assert.equal(await verifyPassword(testPassword, 'scrypt$bogus'), false);
});

test('registration stores only a hash, returns basic info, grants no old projects and rejects duplicates', async () => {
  let account;
  const client = {
    findUserByUsername: async () => account || null,
    createUser: async fields => (account = { id: 'recNewUser', fields }),
    getUser: async () => account,
    listProjectsForUser: async user => { assert.deepEqual(user.projectIds, []); return []; },
    projectStats: async () => ({}),
  };
  await withServer(client, async base => {
    const body = { username: ' New.User ', password: testPassword, fullName: 'New User', email: 'new@example.com', Projects: ['recOther'] };
    const response = await post(base, '/api/auth/register', body);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.user.username, 'new.user');
    assert.equal(data.user.fullName, 'New User');
    assert.equal(data.user.email, body.email);
    assert.deepEqual(data.user.projectIds, []);
    assert.equal(JSON.stringify(data).includes('password'), false);
    assert.equal(account.fields.password, undefined);
    assert.equal(account.fields.Projects, undefined);
    assert.equal(await verifyPassword(testPassword, account.fields.password_hash), true);
    const headers = { cookie: response.headers.get('set-cookie').split(';')[0] };
    assert.equal((await fetch(base + '/api/projects', { headers })).status, 200);
    assert.equal((await post(base, '/api/auth/register', body)).status, 409);
    assert.equal((await post(base, '/api/auth/register', { ...body, password: 'short' })).status, 400);
  });
});

test('login replaces API tokens, uses HttpOnly cookies, restores identity, and logout revokes it', async () => {
  await withServer(userClient(), async base => {
    assert.equal((await fetch(base + '/api/auth/me')).status, 401);
    assert.equal((await fetch(base + '/api/projects', { headers: { Authorization: 'Bearer old-token' } })).status, 401);
    const response = await post(base, '/api/auth/login', { username: 'TESTER', password: testPassword });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    const data = await response.json();
    assert.equal(JSON.stringify(data).includes('password'), false);
    const headers = { cookie: cookie.split(';')[0] };
    assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 200);
    assert.equal((await post(base, '/api/auth/logout', undefined, headers)).status, 200);
    assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 401);
    assert.equal((await post(base, '/niche', {}, headers)).status, 401);
  });
});

test('incorrect, unknown and disabled accounts return the same failure and dependencies fail closed', async () => {
  const client = userClient(); const account = await client.getUser();
  await withServer(client, async base => {
    for (const body of [{ username: 'tester', password: 'wrong' }, { username: 'unknown', password: testPassword }]) {
      const response = await post(base, '/api/auth/login', body);
      assert.equal(response.status, 401); assert.equal((await response.json()).error, 'Invalid username or password');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    account.fields.status = 'Disabled';
    assert.equal((await post(base, '/api/auth/login', { username: 'tester', password: testPassword })).status, 401);
    client.findUserByUsername = async () => { throw new Error('Offline'); };
    assert.equal((await post(base, '/api/auth/login', { username: 'tester', password: testPassword })).status, 503);
  });
});

test('sessions expire and changes to password, status or record existence revoke access', async () => {
  for (const change of ['expiry', 'password', 'status', 'deleted']) {
    let time = 1000;
    const client = userClient(); const account = await client.getUser();
    await withServer(client, async base => {
      const headers = await login(base);
      if (change === 'expiry') time += 5000;
      if (change === 'password') account.fields.password_hash = 'changed';
      if (change === 'status') account.fields.status = 'Disabled';
      if (change === 'deleted') client.getUser = async () => { throw Object.assign(new Error('Gone'), { statusCode: 404 }); };
      assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 401);
    }, { authOptions: { now: () => time, sessionTtlMs: 1000, secureCookies: false } });
  }
});

test('login throttling and CSRF protection reject requests before password work', async () => {
  await withServer(userClient(), async base => {
    const headers = await login(base);
    assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: headers.cookie } })).status, 403);
    assert.equal((await post(base, '/api/auth/logout', undefined, { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await fetch(base + '/api/auth/me', { headers })).status, 200);
    const response = await post(base, '/api/auth/login', { username: 'tester', password: testPassword });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
  }, { authOptions: { secureCookies: false, loginRateLimiter: createRateLimiter({ limit: 1 }) } });
});

test('production session cookies carry Secure and a new login invalidates the prior cookie', async () => {
  await withServer(userClient(), async base => {
    const first = await login(base);
    const second = await post(base, '/api/auth/login', { username: 'tester', password: testPassword }, first);
    assert.equal(second.status, 200); assert.match(second.headers.get('set-cookie'), /Secure/);
    assert.equal((await fetch(base + '/api/auth/me', { headers: first })).status, 401);
  }, { authOptions: { secureCookies: true } });
});

test('project and run endpoints deny other users before reading, writing, or enqueueing', async () => {
  let touched = 0;
  const client = userClient({ getProject: async () => { touched++; throw new Error('Must not read'); } }, ['recOwned']);
  const store = new RunStore();
  const owned = store.create({ projectId: 'recOwned', requestedCount: 1 });
  const other = store.create({ projectId: 'recOther', requestedCount: 1 });
  await withServer(client, async base => {
    const headers = await login(base);
    for (const [route, method, body] of [
      ['/api/projects/recOther', 'GET'], ['/api/projects/recOther/ideas', 'GET'],
      ['/api/projects/recOther/scripts', 'GET'], ['/api/projects/recOther/schedule', 'GET'],
      ['/api/projects/recOther/schedule', 'PUT', {}], ['/api/projects/recOther/status', 'PATCH', { status: 'Inactive' }],
      ['/api/projects/recOther/idea-runs', 'POST', { count: 1 }],
      ['/api/projects/recOther/scripts/recScript/approve', 'POST'],
      ['/api/script-runs', 'POST', { projectId: 'recOther', mode: 'count', count: 1 }],
      ['/api/script-runs?projectId=recOther', 'GET'],
      [`/api/script-runs/${other.id}`, 'GET'], [`/api/script-runs/${other.id}/retry`, 'POST'],
    ]) {
      const response = await fetch(base + route, { method, headers: { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(response.status, 404, route);
    }
    const listed = await fetch(base + '/api/script-runs', { headers });
    assert.deepEqual((await listed.json()).runs.map(run => run.id), [owned.id]);
    assert.equal(touched, 0);
    assert.equal((await post(base, '/niche', {}, headers)).status, 410);
    const account = await client.getUser(); account.fields.Projects = [];
    assert.equal((await fetch(base + `/api/script-runs/${owned.id}`, { headers })).status, 404);
    assert.deepEqual((await (await fetch(base + '/api/script-runs', { headers })).json()).runs, []);
  }, { runStore: store, rateLimiter: createRateLimiter({ limit: 100 }) });
});

test('new projects are atomically linked to the user and request IDs cannot collide across accounts', async () => {
  const saved = new Map(); let account;
  const client = userClient({ createProject: async fields => {
    assert.deepEqual(fields.Users, [account.id]);
    const existing = saved.get(fields.project_id);
    const project = { id: existing?.id || `recCreated${saved.size}`, fields, updated: Boolean(existing) };
    saved.set(fields.project_id, project); account.fields.Projects = [project.id]; return project;
  } }, []);
  account = await client.getUser();
  await withServer(client, async base => {
    const body = { requestId: '3f48ab7b-98ce-4f81-82c8-c820fedd3f50', name: 'Science', niche: 'Science', platform: 'YouTube', targetAudience: 'Adults', contentStyle: 'Education' };
    const headers = await login(base);
    assert.equal((await post(base, '/api/projects', body, headers)).status, 201);
    assert.equal((await post(base, '/api/projects', body, headers)).status, 200);
    assert.equal(saved.size, 1);
    account.id = 'recSecondUser';
    const second = await login(base);
    assert.equal((await post(base, '/api/projects', body, second)).status, 201);
    assert.equal(saved.size, 2);
  });
});
