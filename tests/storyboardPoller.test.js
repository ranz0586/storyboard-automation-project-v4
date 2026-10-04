import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue } from '../src/http/taskQueue.js';
import { StoryboardPoller } from '../src/storyboardPoller.js';

test('storyboard polling shares the bounded queue and never overlaps itself', async () => {
  const queue = new TaskQueue({ maxConcurrency: 1, maxQueued: 1 });
  const order = [];
  let releasePipeline;
  queue.tryEnqueue(async () => {
    order.push('pipeline:start');
    await new Promise((resolve) => { releasePipeline = resolve; });
    order.push('pipeline:end');
  });
  await new Promise((resolve) => setImmediate(resolve));

  const poller = new StoryboardPoller({
    queue,
    run: async () => { order.push('storyboard'); },
    makeClients: () => ({}),
  });
  assert.equal(poller.tick(), true);
  assert.equal(poller.tick(), false);
  assert.deepEqual(order, ['pipeline:start']);

  releasePipeline();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['pipeline:start', 'pipeline:end', 'storyboard']);
});

test('a queue-rejected storyboard poll can be retried later', async () => {
  const queue = new TaskQueue({ maxConcurrency: 1, maxQueued: 0 });
  let release;
  queue.tryEnqueue(() => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  let runs = 0;
  const poller = new StoryboardPoller({
    queue,
    run: async () => { runs += 1; },
    makeClients: () => ({}),
  });

  assert.equal(poller.tick(), false);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(poller.tick(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
});
