import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../src/http/taskQueue.js';

test('TaskQueue runs expensive tasks sequentially and rejects excess backlog', async () => {
  let active = 0;
  let peak = 0;
  const releases = [];
  const completed = [];
  const queue = new TaskQueue({ maxConcurrency: 1, maxQueued: 1 });
  const task = (id) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    completed.push(id);
    active -= 1;
  };

  assert.equal(queue.tryEnqueue(task(1)), true);
  assert.equal(queue.tryEnqueue(task(2)), true);
  assert.equal(queue.tryEnqueue(task(3)), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.active, 1);
  assert.equal(queue.queued, 1);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(completed, [1]);
  assert.equal(queue.active, 1);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(completed, [1, 2]);
  assert.equal(peak, 1);
  assert.equal(queue.active, 0);
});
