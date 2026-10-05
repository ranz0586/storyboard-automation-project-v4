import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { CloudState } from '../src/cloud/state.js';
import {
  createDatabaseLock,
  DatabaseKeyPool,
  databaseRateLimiter,
} from '../src/cloud/coordination.js';
import { nextWeeklyDate } from '../src/cloud/schedule.js';
import { createApp } from '../src/app.js';
import { userClient, login } from './helpers/session.js';
import { config } from '../src/config.js';

let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL('../src/cloud/schema.sql', import.meta.url), 'utf8'));
});
after(async () => {
  await pg?.close();
});
async function fixture(work) {
  await pg.exec(
    'TRUNCATE app_runs,app_schedules,app_sessions,app_leases,app_rate_limits,app_key_slots,app_effects,app_maintenance',
  );
  const db = {
    query: (...args) => pg.query(...args),
    transaction: (fn) => pg.transaction((tx) => fn(tx)),
  };
  await work(db, new CloudState(db));
}
test('cloud state survives a new instance, scopes history and preserves retry links', () =>
  fixture(async (db, state) => {
    const run = await state.create({
      projectId: 'recProject',
      mode: 'selected',
      ideaIds: ['idea1', 'idea2'],
    });
    await state.addItem(run.id, { ideaId: 'idea1', status: 'SUCCEEDED' });
    await state.addItem(run.id, { ideaId: 'idea1', status: 'SUCCEEDED' });
    await state.addItem(run.id, { ideaId: 'idea2', status: 'FAILED' });
    await state.update(run.id, { status: 'PARTIAL' });
    const fresh = new CloudState(db);
    assert.equal((await fresh.get(run.id)).processedCount, 2);
    assert.deepEqual(await fresh.list({ projectIds: ['other'] }), []);
    assert.equal((await fresh.list({ projectIds: ['recProject'] })).length, 1);
    const retry = await fresh.create(null, { retryOf: run.id });
    assert.deepEqual(retry.selectedIdeaIds, ['idea2']);
    assert.equal((await state.create(null, { retryOf: run.id })).id, retry.id);
    assert.equal(await state.get('------------------------------------'), null);
  }));
test('scheduled occurrence and workflow actor claims prevent duplicate jobs', () =>
  fixture(async (db, state) => {
    const input = { projectId: 'recProject', mode: 'count', count: 1 };
    const one = await state.create(input, { source: 'SCHEDULED', occurrence: '2026-week' });
    const two = await state.create(input, { source: 'SCHEDULED', occurrence: '2026-week' });
    assert.equal(one.id, two.id);
    assert.equal(await state.claimWorkflow(one.id, 'actor1'), true);
    assert.equal(await state.claimWorkflow(one.id, 'actor2'), false);
    await state.update(one.id, { status: 'INTERRUPTED' });
    assert.equal(await state.claimWorkflow(one.id, 'actor1'), false);
    const retry = await state.create(null, { retryOf: one.id });
    assert.equal(retry.requestedCount, 1);
    const schedule = await state.setSchedule('recProject', {
      enabled: true,
      dayOfWeek: 1,
      time: '10:00',
      scriptCount: 1,
    });
    assert.equal(await state.claimSchedule('recProject', schedule.generation, 'a'), true);
    assert.equal(await state.claimSchedule('recProject', schedule.generation, 'b'), false);
    const changed = await state.setSchedule('recProject', { ...schedule, time: '11:00' });
    assert.equal(await state.claimSchedule('recProject', schedule.generation, 'a'), false);
    assert.equal(await state.claimSchedule('recProject', changed.generation, 'b'), true);
  }));
test('global capacity, leases and key cooldowns span independent instances', () =>
  fixture(async (db, state) => {
    const capacity = config.server.maxQueuedPipelines + config.server.maxConcurrentPipelines;
    for (let n = 0; n < capacity; n++)
      assert.ok(await state.create({ projectId: 'p', mode: 'count', count: 1 }));
    assert.equal(await state.create({ projectId: 'p', mode: 'count', count: 1 }), null);
    const withLock = createDatabaseLock(db);
    await withLock('work', async () => {
      await assert.rejects(
        createDatabaseLock(db)('work', () => assert.fail('duplicate provider work')),
        (error) => error.code === 'DEFERRED',
      );
    });
    assert.equal(await withLock('work', () => 42), 42);
    const keys = ['test-key-not-live'];
    assert.equal((await new DatabaseKeyPool(db, keys, 60000).acquire()).index, 0);
    await assert.rejects(
      new DatabaseKeyPool(db, keys, 60000).acquire(),
      (error) => error.code === 'DEFERRED',
    );
    const stored = await db.query('SELECT id FROM app_key_slots');
    assert.equal(stored.rows[0].id.includes(keys[0]), false);
  }));
test('cloud sessions, logout and account limits survive fresh Express instances', () =>
  fixture(async (db, state) => {
    const client = userClient({ projectStats: async () => ({}) });
    const makeApp = () =>
      createApp({
        makeAirtable: () => client,
        runStore: new CloudState(db),
        scheduleStore: state,
        pipelineQueue: {},
        scriptRunController: {},
        ideaRunController: {},
        authOptions: {
          sessionStore: new CloudState(db).sessions,
          withLock: createDatabaseLock(db),
          secureCookies: false,
        },
        readRateLimiter: databaseRateLimiter(db, { name: 'read-test', limit: 3, windowMs: 60000 }),
      });
    const servers = [makeApp().listen(0, '127.0.0.1'), makeApp().listen(0, '127.0.0.1')];
    await Promise.all(servers.map((server) => once(server, 'listening')));
    const urls = servers.map((server) => 'http://127.0.0.1:' + server.address().port);
    try {
      const headers = await login(urls[0]);
      assert.equal((await fetch(urls[1] + '/api/auth/me', { headers })).status, 200);
      assert.equal((await fetch(urls[0] + '/api/script-runs', { headers })).status, 200);
      assert.equal((await fetch(urls[1] + '/api/script-runs', { headers })).status, 200);
      assert.equal((await fetch(urls[0] + '/api/script-runs', { headers })).status, 429);
      assert.equal(
        (await fetch(urls[1] + '/api/auth/logout', { method: 'POST', headers })).status,
        200,
      );
      assert.equal((await fetch(urls[0] + '/api/auth/me', { headers })).status, 401);
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  }));
test('effect checkpoints preserve text, objects, arrays and false values', () =>
  fixture(async (db, state) => {
    for (const [index, value] of ['text', [1, 2], { ok: true }, false, null].entries()) {
      await state.saveEffect('effect:' + index, value);
      assert.deepEqual(await new CloudState(db).effect('effect:' + index), value);
    }
    assert.equal(await state.effect('missing'), undefined);
    await state.saveEffect('effect:0', 'replacement');
    assert.equal(await state.effect('effect:0'), 'text');
  }));
test('weekly wakeups use Singapore wall time and skip DST gaps', () => {
  assert.equal(
    nextWeeklyDate(
      { dayOfWeek: 1, time: '10:00' },
      new Date('2026-10-04T00:00:00Z'),
      'Asia/Singapore',
    ).toISOString(),
    '2026-10-05T02:00:00.000Z',
  );
  assert.equal(
    nextWeeklyDate(
      { dayOfWeek: 0, time: '02:30' },
      new Date('2026-03-08T05:00:00Z'),
      'America/New_York',
    ).toISOString(),
    '2026-03-15T06:30:00.000Z',
  );
});

test('resumed cloud work reuses model, idea-save and metadata checkpoints', () =>
  fixture(async (db) => {
    const { createCloudContext } = await import('../src/cloud/context.js');
    let models = 0,
      saves = 0,
      searches = 0;
    const options = {
      db,
      makeGemini: () => ({
        generate: async () => {
          models++;
          return { text: 'saved' };
        },
      }),
      makeAirtable: () => ({
        upsertIdea: async (fields) => {
          saves++;
          return { id: 'idea', fields };
        },
      }),
      makeTelegram: () => ({}),
      searchMetadata: async () => {
        searches++;
        return [{ title: 'video' }];
      },
    };
    const first = createCloudContext(options).clients('run:test');
    const second = createCloudContext(options).clients('run:test');
    assert.deepEqual(
      await first.gemini.generate({ prompt: 'same' }),
      await second.gemini.generate({ prompt: 'same' }),
    );
    assert.deepEqual(
      await first.airtable.upsertIdea({ title: 'same' }),
      await second.airtable.upsertIdea({ title: 'same' }),
    );
    assert.deepEqual(await first.search('same'), await second.search('same'));
    assert.deepEqual([models, saves, searches], [1, 1, 1]);
    const context = createCloudContext(options);
    let entered = 0;
    await assert.rejects(
      context.withSlot(async () => {
        entered++;
        const e = new Error('cooldown');
        e.code = 'DEFERRED';
        e.retryAt = 123;
        throw e;
      }),
      (e) => e.retryAt === 123,
    );
    assert.equal(entered, 1);
  }));
test('local import is idempotent, preserves schedule history and exposes unfinished runs for retry', () =>
  fixture(async (db, state) => {
    const { importLocalState } = await import('../src/cloud/importState.js');
    const run = await state.create({
      projectId: 'recProject',
      mode: 'selected',
      ideaIds: ['idea1'],
    });
    await db.query('DELETE FROM app_runs');
    const source = {
      runs: [{ ...run, status: 'RUNNING', currentItem: 'idea1', owner: { pid: 1 } }],
      schedules: [
        {
          projectId: 'recProject',
          enabled: true,
          dayOfWeek: 1,
          time: '10:00',
          scriptCount: 1,
          lastRunKey: '2026-10-05T10:00',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    };
    assert.deepEqual(await importLocalState(db, source), { importedRuns: 1, importedSchedules: 1 });
    assert.deepEqual(await importLocalState(db, source), { importedRuns: 0, importedSchedules: 0 });
    const saved = await state.get(run.id);
    assert.equal(saved.status, 'INTERRUPTED');
    assert.equal(saved.owner, undefined);
    assert.equal((await state.getSchedule('recProject')).lastRunKey, '2026-10-05T10:00');
    assert.deepEqual((await state.create(null, { retryOf: run.id })).selectedIdeaIds, ['idea1']);
  }));
test('failed storyboard polling can retry while successful occurrence remains idempotent', () =>
  fixture(async (db, state) => {
    const input = { projectId: 'recProject', mode: 'selected', ideaIds: ['script1'] };
    const options = { type: 'STORYBOARD', source: 'APPROVAL', occurrence: 'storyboard:script1' };
    const run = await state.create(input, options);
    await state.update(run.id, {
      status: 'FAILED',
      workflowId: 'old',
      items: [{ scriptId: 'script1', status: 'FAILED' }],
    });
    const retry = await state.create(input, options);
    assert.equal(retry.id, run.id);
    assert.equal(retry.workflowId, null);
    assert.equal(retry.attempt, 1);
    assert.deepEqual(retry.items, []);
    await state.update(run.id, { status: 'COMPLETED' });
    assert.equal((await state.create(input, options)).status, 'COMPLETED');
  }));

test('zero-cooldown key rotation and failed storyboard retries still obey global bounds', () =>
  fixture(async (db, state) => {
    const first = new DatabaseKeyPool(db, ['key-a', 'key-b'], 0);
    const second = new DatabaseKeyPool(db, ['key-a', 'key-b'], 0);
    assert.notEqual((await first.acquire()).index, (await second.acquire()).index);
    const options = { type: 'STORYBOARD', source: 'APPROVAL', occurrence: 'storyboard:script' };
    const input = { projectId: 'p', mode: 'selected', ideaIds: ['script'] };
    const failed = await state.create(input, options);
    await state.update(failed.id, { status: 'FAILED' });
    for (
      let i = 0;
      i < config.server.maxQueuedPipelines + config.server.maxConcurrentPipelines;
      i++
    )
      await state.create({ projectId: 'p', mode: 'count', count: 1 });
    assert.equal(await state.create(input, options), null);
    assert.equal((await state.get(failed.id)).status, 'FAILED');
  }));
test('cron recovers a failed schedule owner without resetting its occurrence boundary', () =>
  fixture(async (db, state) => {
    const { cloudControllers } = await import('../src/cloud/controllers.js');
    const schedule = await state.setSchedule('p', {
      enabled: true,
      dayOfWeek: 1,
      time: '10:00',
      scriptCount: 1,
    });
    await state.claimSchedule('p', schedule.generation, 'failed-actor');
    const starts = [];
    const controller = cloudControllers(
      state,
      async (fn, args) => {
        starts.push(args);
        return { runId: 'new' };
      },
      { inspectWorkflow: () => ({ exists: true, status: 'failed' }) },
    );
    await controller.reconcile();
    const saved = await state.getSchedule('p');
    assert.equal(saved.generation, schedule.generation);
    assert.equal(saved.updatedAt, schedule.updatedAt);
    assert.equal(saved.workflowId, undefined);
    assert.ok(starts.some((args) => args[0] === 'p' && args[1] === schedule.generation));
  }));

test('Supabase runtime tables deny Data API roles while server transactions still work', () =>
  fixture(async (db, state) => {
    await db.query('CREATE ROLE anon');
    await db.query('CREATE ROLE authenticated');
    await db.query('GRANT USAGE ON SCHEMA public TO anon,authenticated');
    await db.query('GRANT ALL ON app_sessions TO anon,authenticated');
    await pg.exec(await readFile(new URL('../src/cloud/schema.sql', import.meta.url), 'utf8'));
    const rows = await db.query(
      'SELECT relname,relrowsecurity FROM pg_class WHERE relname=ANY($1::text[])',
      [
        [
          'app_runs',
          'app_schedules',
          'app_sessions',
          'app_leases',
          'app_rate_limits',
          'app_key_slots',
          'app_effects',
          'app_maintenance',
        ],
      ],
    );
    assert.equal(rows.rows.length, 8);
    assert.ok(rows.rows.every((row) => row.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      const permissions = await db.query(
        "SELECT has_table_privilege($1,'public.app_sessions','SELECT') AS allowed",
        [role],
      );
      assert.equal(permissions.rows[0].allowed, false);
      await db.query('SET ROLE ' + role);
      try {
        await assert.rejects(db.query('SELECT * FROM app_sessions'), /permission denied/);
      } finally {
        await db.query('RESET ROLE');
      }
    }
    const run = await state.create({ projectId: 'p', mode: 'count', count: 1 });
    assert.ok(run.id);
  }));
