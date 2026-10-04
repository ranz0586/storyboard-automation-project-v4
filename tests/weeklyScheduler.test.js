import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { WeeklyScheduler, latestWeeklyRunKey, zonedMinute } from '../src/schedules/weeklyScheduler.js';

test('ScheduleStore persists weekly configuration across instances', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-schedule-'));
  const filePath = path.join(directory, 'schedules.json');
  try {
    const first = new ScheduleStore({ filePath });
    first.set('recProject1', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 10 });

    const second = new ScheduleStore({ filePath });
    assert.deepEqual(second.get('recProject1'), first.get('recProject1'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('weekly scheduler creates one scheduled run through the shared controller', () => {
  const store = new ScheduleStore({ now: () => new Date('2026-08-23T00:00:00Z') });
  const date = new Date('2026-08-24T01:00:00.000Z'); // Monday 09:00 Singapore
  const minute = zonedMinute(date, 'Asia/Singapore');
  store.set('recProject1', {
    enabled: true,
    dayOfWeek: minute.dayOfWeek,
    time: minute.time,
    scriptCount: 7,
  });
  const calls = [];
  const scheduler = new WeeklyScheduler({
    scheduleStore: store,
    timeZone: 'Asia/Singapore',
    scriptRunController: {
      create: (input, options) => {
        calls.push({ input, options });
        return { id: 'run1', source: options.source };
      },
    },
  });

  assert.equal(scheduler.tick(date).length, 1);
  assert.equal(scheduler.tick(date).length, 0);
  assert.deepEqual(calls, [{
    input: { projectId: 'recProject1', mode: 'count', count: 7, scheduledFor: '2026-08-24T09:00' },
    options: { source: 'SCHEDULED' },
  }]);
  assert.equal(store.get('recProject1').lastRunId, 'run1');
});

test('weekly scheduler ignores disabled, non-due, and queue-rejected schedules', () => {
  const store = new ScheduleStore({ now: () => new Date('2026-08-23T00:00:00Z') });
  store.set('disabled', { enabled: false, dayOfWeek: 1, time: '09:00', scriptCount: 3 });
  store.set('not-due', { enabled: true, dayOfWeek: 2, time: '09:00', scriptCount: 3 });
  store.set('queue-full', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 3 });
  const scheduler = new WeeklyScheduler({
    scheduleStore: store,
    timeZone: 'Asia/Singapore',
    scriptRunController: { create: () => null },
  });
  assert.deepEqual(scheduler.tick(new Date('2026-08-24T01:00:00.000Z')), []);
  assert.equal(store.get('queue-full').lastRunKey, null);
});

test('weekly scheduler catches up after the exact scheduled minute was missed', () => {
  const schedule = {
    projectId: 'recProject1',
    enabled: true,
    dayOfWeek: 1,
    time: '09:00',
    scriptCount: 4,
    lastRunKey: null,
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
  const marked = [];
  const scheduler = new WeeklyScheduler({
    scheduleStore: {
      listEnabled: () => [schedule],
      markRun: (...args) => marked.push(args),
    },
    timeZone: 'Asia/Singapore',
    scriptRunController: { create: () => ({ id: 'run-catch-up' }) },
  });

  const now = new Date('2026-08-24T01:17:00.000Z'); // Monday 09:17 Singapore
  assert.equal(scheduler.tick(now).length, 1);
  assert.equal(marked[0][1], '2026-08-24T09:00');
});

test('weekly scheduler does not backfill an occurrence before schedule configuration', () => {
  const schedule = {
    projectId: 'recProject1',
    enabled: true,
    dayOfWeek: 1,
    time: '09:00',
    scriptCount: 4,
    lastRunKey: null,
    updatedAt: '2026-08-24T02:00:00.000Z', // Monday 10:00 Singapore
  };
  let calls = 0;
  const scheduler = new WeeklyScheduler({
    scheduleStore: { listEnabled: () => [schedule], markRun: () => {} },
    timeZone: 'Asia/Singapore',
    scriptRunController: { create: () => { calls += 1; return { id: 'run1' }; } },
  });

  assert.deepEqual(scheduler.tick(new Date('2026-08-24T04:00:00.000Z')), []);
  assert.equal(calls, 0);
  assert.equal(
    latestWeeklyRunKey(schedule, new Date('2026-08-24T04:00:00.000Z'), 'Asia/Singapore'),
    '2026-08-24T09:00'
  );
});

test('editing a previously executed schedule waits for the next occurrence', () => {
  let now = new Date('2026-08-23T00:00:00Z');
  const store = new ScheduleStore({ now: () => now });
  store.set('project', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 3 });
  const calls = [];
  const scheduler = new WeeklyScheduler({ scheduleStore: store, timeZone: 'Asia/Singapore',
    scriptRunController: { create: (input) => { calls.push(input); return { id: `run${calls.length}` }; } } });
  assert.equal(scheduler.tick(new Date('2026-08-24T01:00:00Z')).length, 1);
  now = new Date('2026-08-24T04:00:00Z'); // Monday noon: new 10:00 time has already passed.
  store.set('project', { enabled: true, dayOfWeek: 1, time: '10:00', scriptCount: 7 });
  assert.equal(store.get('project').lastRunId, 'run1');
  assert.deepEqual(scheduler.tick(now), []);
  assert.deepEqual(scheduler.tick(new Date('2026-08-30T04:00:00Z')), []);
  assert.equal(scheduler.tick(new Date('2026-08-31T02:17:00Z')).length, 1);
  assert.equal(calls[1].count, 7);
  assert.deepEqual(scheduler.tick(new Date('2026-08-31T02:18:00Z')), []);
});

test('re-enabling after missed weeks does not backfill and queue rejection remains retryable', () => {
  let now = new Date('2026-08-23T00:00:00Z');
  const store = new ScheduleStore({ now: () => now });
  const input = { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 3 };
  store.set('project', input);
  store.markRun('project', '2026-08-24T09:00', 'old-run');
  now = new Date('2026-08-25T00:00:00Z');
  store.set('project', { ...input, enabled: false });
  now = new Date('2026-09-07T04:00:00Z');
  store.set('project', input);
  let accept = false, attempts = 0;
  const scheduler = new WeeklyScheduler({ scheduleStore: store, timeZone: 'Asia/Singapore',
    scriptRunController: { create: () => { attempts++; return accept ? { id: 'new-run' } : null; } } });
  assert.deepEqual(scheduler.tick(now), []);
  assert.equal(attempts, 0);
  const nextDue = new Date('2026-09-14T01:00:00Z');
  assert.deepEqual(scheduler.tick(nextDue), []);
  assert.equal(store.get('project').lastRunId, 'old-run');
  accept = true;
  assert.equal(scheduler.tick(nextDue).length, 1);
});

test('schedule configured at the due minute starts next week, including after reload', () => {
  const schedule = { projectId: 'project', enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 1,
    updatedAt: '2026-08-24T01:00:30Z', lastRunKey: '2026-08-17T09:00' };
  const scheduler = new WeeklyScheduler({ scheduleStore: { listEnabled: () => [structuredClone(schedule)], markRun: () => {} },
    timeZone: 'Asia/Singapore', scriptRunController: { create: () => ({ id: 'run' }) } });
  assert.deepEqual(scheduler.tick(new Date('2026-08-24T01:01:00Z')), []);
  assert.equal(scheduler.tick(new Date('2026-08-31T01:01:00Z')).length, 1);
});
