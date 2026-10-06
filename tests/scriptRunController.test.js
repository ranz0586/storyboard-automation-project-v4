import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunStore } from '../src/runs/runStore.js';
import { ScriptRunController } from '../src/runs/scriptRunController.js';
import { TaskQueue } from '../src/http/taskQueue.js';
import { withScriptValidation } from './helpers/scriptValidation.js';

test('interrupted resume is idempotent and does not retry active or non-script runs', () => {
  const store = new RunStore();
  let queued = 0;
  const controller = new ScriptRunController({ store, queue: {
    canAccept: true, tryEnqueue: () => { queued++; return true; },
  } });
  const prior = store.create({ projectId: 'recProject1', requestedCount: 2,
    selectedIdeaIds: ['recDone', 'recPending'], source: 'RECOVERY' });
  assert.deepEqual(controller.retry(prior.id), { error: 'NO_FAILED_ITEMS' });
  store.addItem(prior.id, { ideaId: 'recDone', status: 'SUCCEEDED' });
  store.update(prior.id, { status: 'INTERRUPTED', successfulCount: 1,
    processedCount: 1, interruptedItem: 'recPending' });
  const resumed = controller.retry(prior.id);
  assert.deepEqual(resumed.selectedIdeaIds, ['recPending']);
  assert.equal(resumed.source, 'RECOVERY');
  assert.equal(controller.retry(prior.id).id, resumed.id);
  assert.equal(queued, 1);
  const ideaRun = store.create({ projectId: 'recProject1', requestedCount: 1, type: 'IDEAS' });
  store.update(ideaRun.id, { status: 'INTERRUPTED' });
  assert.deepEqual(controller.retry(ideaRun.id), { error: 'NO_FAILED_ITEMS' });
});

function idea(id, title) {
  return {
    id,
    fields: {
      title,
      niche: 'Science',
      platform: 'YouTube',
      Projects: 'Science_YouTube',
      'Idea Status': 'Draft',
    },
  };
}

function output(title) {
  return {
    scripts: [{
      video: {
        video_id: `model-${title}`,
        title: `Script ${title}`,
        estimated_duration_seconds: 30,
        voiceover: { full_script: `Narration ${title}` },
      },
      scenes: [{ scene_number: 1, duration_seconds: 3, narration: title }],
    }],
  };
}

async function terminal(store, id) {
  for (let i = 0; i < 200; i++) {
    const run = store.get(id);
    if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not reach a terminal state');
}

function fixture(ideas, { failures = new Set() } = {}) {
  const store = new RunStore();
  const queue = new TaskQueue({ maxConcurrency: 1, maxQueued: 10 });
  const scripts = new Map();
  let activeGenerations = 0;
  let peakGenerations = 0;
  const updatedIdeas = [];
  const airtable = {
    getProject: async () => ({
      id: 'recProject1',
      fields: { project_id: 'Science_YouTube', niche: 'Science', platform: 'YouTube', target_audience: 'Adults' },
    }),
    getIdea: async (id) => ideas.find((item) => item.id === id),
    forEachEligibleIdea: async (_projectId, { limit }, visit) => {
      let count = 0;
      for (const item of ideas) {
        if (count >= limit) break;
        await visit(item);
        count += 1;
      }
      return count;
    },
    findScriptByVideoId: async (id) => scripts.get(id) || null,
    upsertScript: async (fields) => {
      const record = { id: `recScript-${fields.video_id}`, fields };
      scripts.set(fields.video_id, record);
      return record;
    },
    updateIdea: async (id) => updatedIdeas.push(id),
  };
  const gemini = withScriptValidation(async ({ prompt }) => {
      const match = ideas.find((item) => prompt.includes(item.fields.title));
      if (failures.has(match?.id)) throw new Error(`Gemini failed for ${match.id}`);
      activeGenerations += 1;
      peakGenerations = Math.max(peakGenerations, activeGenerations);
      await new Promise((resolve) => setImmediate(resolve));
      activeGenerations -= 1;
      return output(match?.fields.title || 'unknown');
    });
  const controller = new ScriptRunController({
    store,
    queue,
    makeGemini: () => gemini,
    makeAirtable: () => airtable,
    makeTelegram: () => ({ errorAlert: async () => {} }),
  });
  return { store, controller, scripts, updatedIdeas, peak: () => peakGenerations };
}

test('count-based run processes scripts sequentially and tracks completion', async () => {
  const fx = fixture([idea('idea1', 'One'), idea('idea2', 'Two'), idea('idea3', 'Three')]);
  const queued = fx.controller.create({ projectId: 'recProject1', mode: 'count', count: 3 });
  assert.equal(queued.status, 'QUEUED');

  const run = await terminal(fx.store, queued.id);
  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.successfulCount, 3);
  assert.equal(run.failedCount, 0);
  assert.equal(run.processedCount, 3);
  assert.equal(fx.peak(), 1);
  assert.equal(fx.scripts.size, 3);
  assert.deepEqual(fx.updatedIdeas, ['idea1', 'idea2', 'idea3']);
});

test('selected run records partial failure and retries only failed ideas safely', async () => {
  const failures = new Set(['idea2']);
  const fx = fixture([idea('idea1', 'One'), idea('idea2', 'Two')], { failures });
  const first = fx.controller.create({
    projectId: 'recProject1',
    mode: 'selected',
    ideaIds: ['idea1', 'idea2'],
  });
  const partial = await terminal(fx.store, first.id);
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.successfulCount, 1);
  assert.equal(partial.failedCount, 1);
  assert.deepEqual(partial.items.map((item) => item.status), ['SUCCEEDED', 'FAILED']);

  failures.clear();
  const retry = fx.controller.retry(first.id);
  assert.deepEqual(retry.selectedIdeaIds, ['idea2']);
  const completed = await terminal(fx.store, retry.id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.successfulCount, 1);
  assert.equal(fx.scripts.size, 2);
});

test('interrupted selected run retries only unfinished ideas and records its replacement', async () => {
  const fx = fixture([idea('idea1', 'One'), idea('idea2', 'Two')]);
  const prior = fx.store.create({
    projectId: 'recProject1',
    requestedCount: 2,
    selectedIdeaIds: ['idea1', 'idea2'],
  });
  fx.store.addItem(prior.id, { ideaId: 'idea1', status: 'SUCCEEDED' });
  fx.store.update(prior.id, { status: 'INTERRUPTED', successfulCount: 1 });
  const replacement = fx.controller.retry(prior.id);
  assert.deepEqual(replacement.selectedIdeaIds, ['idea2']);
  assert.equal(fx.store.get(prior.id).recoveredByRunId, replacement.id);
  assert.equal((await terminal(fx.store, replacement.id)).status, 'COMPLETED');
});

test('count replay processes the interrupted idea before one remaining eligible idea', async () => {
  const fx = fixture([idea('idea1', 'One'), idea('idea2', 'Two'), idea('idea3', 'Three')]);
  const queued = fx.controller.create({
    projectId: 'recProject1',
    mode: 'count',
    count: 2,
    preferredIdeaIds: ['idea2'],
  }, { source: 'SCHEDULED' });
  const run = await terminal(fx.store, queued.id);
  assert.equal(run.status, 'COMPLETED');
  assert.deepEqual(run.items.map((item) => item.ideaId), ['idea2', 'idea1']);
  assert.equal(run.processedCount, 2);
});

test('script run converts an Idea multi-select platform to one input value', async () => {
  const item = idea('idea-array', 'Array platform');
  item.fields.platform = ['YouTube Shorts'];
  const fx = fixture([item]);
  const queued = fx.controller.create({ projectId: 'recProject1', mode: 'selected', ideaIds: [item.id] });
  assert.equal((await terminal(fx.store, queued.id)).status, 'COMPLETED');
  assert.equal(fx.scripts.get(`idea_${item.id}`).fields.platform_input, 'YouTube Shorts');
});

test('count-based run reports a shortfall instead of fake completion', async () => {
  const fx = fixture([idea('idea1', 'One')]);
  const queued = fx.controller.create({ projectId: 'recProject1', mode: 'count', count: 3 });
  const run = await terminal(fx.store, queued.id);
  assert.equal(run.status, 'PARTIAL');
  assert.equal(run.successfulCount, 1);
  assert.equal(run.failedCount, 2);
  assert.match(run.error, /Only 1 eligible idea/);
});

test('conflicting runs for the same idea complete without duplicate generation', async () => {
  const fx = fixture([idea('idea1', 'One')]);
  const first = fx.controller.create({
    projectId: 'recProject1',
    mode: 'selected',
    ideaIds: ['idea1'],
  });
  const second = fx.controller.create({
    projectId: 'recProject1',
    mode: 'selected',
    ideaIds: ['idea1'],
  });

  const [firstDone, secondDone] = await Promise.all([
    terminal(fx.store, first.id),
    terminal(fx.store, second.id),
  ]);
  assert.equal(firstDone.status, 'COMPLETED');
  assert.equal(secondDone.status, 'COMPLETED');
  assert.equal(firstDone.items[0].generated, true);
  assert.equal(secondDone.items[0].generated, false);
  assert.equal(fx.scripts.size, 1);
  assert.equal(fx.peak(), 1);
});
