import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { WeeklyScheduler } from '../src/schedules/weeklyScheduler.js';

const runProcess = promisify(execFile);

test('active runs survive pruning and restart as retryable interruptions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'));
  try {
    const filePath = path.join(directory, 'runs.json');
    const store = new RunStore({ filePath, maxRuns: 10 });
    const active = store.create({ projectId: 'project', requestedCount: 2, selectedIdeaIds: ['idea1', 'idea2'] });
    store.update(active.id, { status: 'RUNNING', successfulCount: 1 });
    store.addItem(active.id, { ideaId: 'idea1', status: 'SUCCEEDED' });
    for (let i = 0; i < 15; i++) {
      const done = store.create({ projectId: 'project', requestedCount: 0 });
      store.update(done.id, { status: 'COMPLETED' });
    }
    assert.equal(store.get(active.id).status, 'RUNNING');
    // Simulate the old process having exited; a second live owner must not
    // interrupt work merely by opening the shared file.
    const reopened = new RunStore({ filePath, maxRuns: 10, isOwnerAlive: () => false });
    assert.equal(reopened.get(active.id).status, 'INTERRUPTED');
    assert.equal(reopened.get(active.id).successfulCount, 1);
    assert.deepEqual(reopened.get(active.id).items.map((item) => item.ideaId), ['idea1']);
    for (let i = 0; i < 15; i++) {
      const done = reopened.create({ projectId: 'project', requestedCount: 0 });
      reopened.update(done.id, { status: 'COMPLETED' });
    }
    assert.equal(reopened.get(active.id).status, 'INTERRUPTED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduled occurrence interrupted by restart is queued again once', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-restart-'));
  try {
    const runPath = path.join(directory, 'runs.json');
    const schedulePath = path.join(directory, 'schedules.json');
    const at = new Date('2026-08-24T01:00:00Z');
    const schedules = new ScheduleStore({ filePath: schedulePath, now: () => new Date('2026-08-23T00:00:00Z') });
    schedules.set('project', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 1 });
    const first = new RunStore({ filePath: runPath });
    const pending = first.create({ projectId: 'project', requestedCount: 1, source: 'SCHEDULED' });
    schedules.markRun('project', '2026-08-24T09:00', pending.id);
    const restarted = new RunStore({ filePath: runPath, isOwnerAlive: () => false });
    const calls = [];
    const scheduler = new WeeklyScheduler({
      scheduleStore: new ScheduleStore({ filePath: schedulePath }),
      timeZone: 'Asia/Singapore',
      scriptRunController: {
        store: restarted,
        create: (input, options) => { calls.push({ input, options }); return { id: 'replacement' }; },
      },
    });
    assert.equal(scheduler.tick(at).length, 1);
    assert.equal(scheduler.tick(at).length, 0);
    assert.equal(scheduler.scheduleStore.get('project').lastRunId, 'replacement');
    assert.equal(restarted.get(pending.id).recoveredByRunId, 'replacement');
    assert.equal(calls[0].options.source, 'SCHEDULED');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduled replay requests only unfinished scripts and retries the in-flight idea', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-partial-restart-'));
  try {
    const runPath = path.join(directory, 'runs.json');
    const schedules = new ScheduleStore({ now: () => new Date('2026-08-23T00:00:00Z') });
    schedules.set('project', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 3 });
    const first = new RunStore({ filePath: runPath });
    const pending = first.create({ projectId: 'project', requestedCount: 3, source: 'SCHEDULED' });
    first.addItem(pending.id, { ideaId: 'idea1', status: 'SUCCEEDED' });
    first.update(pending.id, { status: 'RUNNING', successfulCount: 1, processedCount: 1, currentItem: 'idea2' });
    schedules.markRun('project', '2026-08-24T09:00', pending.id);
    const restarted = new RunStore({ filePath: runPath, isOwnerAlive: () => false });
    const calls = [];
    const scheduler = new WeeklyScheduler({
      scheduleStore: schedules,
      timeZone: 'Asia/Singapore',
      scriptRunController: {
        store: restarted,
        create: (input, options) => { calls.push({ input, options }); return { id: 'replacement' }; },
      },
    });
    scheduler.tick(new Date('2026-08-24T01:00:00Z'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.count, 2);
    assert.deepEqual(calls[0].input.preferredIdeaIds, ['idea2']);
    assert.equal(restarted.get(pending.id).recoveredByRunId, 'replacement');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a new Node process detects an interrupted scheduled run and requeues it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-process-restart-'));
  try {
    const worker = path.join(directory, 'worker.mjs');
    const runModule = new URL('../src/runs/runStore.js', import.meta.url).href;
    const scheduleModule = new URL('../src/schedules/scheduleStore.js', import.meta.url).href;
    const weeklyModule = new URL('../src/schedules/weeklyScheduler.js', import.meta.url).href;
    fs.writeFileSync(worker, `import { RunStore } from ${JSON.stringify(runModule)};
import { ScheduleStore } from ${JSON.stringify(scheduleModule)};
import { WeeklyScheduler } from ${JSON.stringify(weeklyModule)};
const runs = new RunStore({ filePath: ${JSON.stringify(path.join(directory, 'runs.json'))} });
const schedules = new ScheduleStore({ filePath: ${JSON.stringify(path.join(directory, 'schedules.json'))}, now: () => new Date('2026-08-23T00:00:00Z') });
if (process.argv[2] === 'first') {
  schedules.set('project', { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 1 });
  const pending = runs.create({ projectId: 'project', requestedCount: 1, source: 'SCHEDULED' });
  runs.update(pending.id, { status: 'RUNNING', currentItem: 'idea1' });
  schedules.markRun('project', '2026-08-24T09:00', pending.id);
  console.log(pending.id);
} else {
  const pendingId = schedules.get('project').lastRunId;
  const before = runs.get(pendingId);
  const scheduler = new WeeklyScheduler({ scheduleStore: schedules, timeZone: 'Asia/Singapore',
    scriptRunController: { store: runs, create: () => ({ id: 'replacement' }) } });
  const started = scheduler.tick(new Date('2026-08-24T01:00:00Z'));
  console.log(JSON.stringify({ status: before.status, interruptedItem: before.interruptedItem,
    started: started.length, lastRunId: schedules.get('project').lastRunId }));
}`);
    const first = await runProcess(process.execPath, [worker, 'first']);
    assert.ok(first.stdout.trim());
    const second = await runProcess(process.execPath, [worker, 'second']);
    const result = JSON.parse(second.stdout.trim().split('\n').at(-1));
    assert.deepEqual(result, {
      status: 'INTERRUPTED', interruptedItem: 'idea1', started: 1, lastRunId: 'replacement',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
