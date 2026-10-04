import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunStore } from '../src/runs/runStore.js';
import { TaskQueue } from '../src/http/taskQueue.js';
import { IdeaRunController } from '../src/runs/ideaRunController.js';

async function terminal(store, id) {
  for (let i = 0; i < 100; i++) {
    const run = store.get(id);
    if (['COMPLETED', 'PARTIAL', 'FAILED'].includes(run.status)) return run;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('idea run did not finish');
}

test('idea run uses an existing explicit project and tracks saved ideas', async () => {
  const store = new RunStore();
  const queue = new TaskQueue({ maxConcurrency: 1, maxQueued: 2 });
  const saved = [];
  const gemini = {
    generate: async ({ prompt }) => {
      if (prompt.startsWith('Plan YouTube')) return [];
      if (prompt.startsWith('Research trending')) return { report: 'Research' };
      return { concepts: [{ title: 'Idea One' }, { title: 'Idea Two' }] };
    },
  };
  const airtable = {
    getProject: async () => ({
      id: 'recProject1',
      fields: {
        project_id: 'Science_YouTube',
        channel_page_name: 'Science Daily',
        niche: 'Science',
        platform: 'YouTube',
        target_audience: 'Adults',
        content_style: 'Edutainment',
      },
    }),
    upsertIdea: async (fields) => {
      const record = { id: `idea${saved.length + 1}`, fields };
      saved.push(record);
      return record;
    },
  };
  const controller = new IdeaRunController({
    store,
    queue,
    makeGemini: () => gemini,
    makeAirtable: () => airtable,
  });

  const queued = controller.create({ projectId: 'recProject1', count: 2 });
  const run = await terminal(store, queued.id);
  assert.equal(run.type, 'IDEAS');
  assert.equal(run.status, 'COMPLETED');
  assert.equal(run.successfulCount, 2);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].fields.Projects, 'Science_YouTube');
  assert.equal(saved[0].fields['Idea Status'], 'Draft');
});

test('idea run reports a shortfall as partial', async () => {
  const store = new RunStore();
  const controller = new IdeaRunController({
    store,
    queue: new TaskQueue({ maxConcurrency: 1, maxQueued: 1 }),
    makeGemini: () => ({
      generate: async ({ prompt }) => {
        if (prompt.startsWith('Plan YouTube')) return [];
        if (prompt.startsWith('Research trending')) return { report: 'Research' };
        return { concepts: [{ title: 'Only Idea' }] };
      },
    }),
    makeAirtable: () => ({
      getProject: async () => ({ id: 'recProject1', fields: { project_id: 'Science_YouTube', niche: 'Science' } }),
      upsertIdea: async (fields) => ({ id: 'idea1', fields }),
    }),
  });
  const queued = controller.create({ projectId: 'recProject1', count: 3 });
  const run = await terminal(store, queued.id);
  assert.equal(run.status, 'PARTIAL');
  assert.equal(run.successfulCount, 1);
  assert.equal(run.failedCount, 2);
});
