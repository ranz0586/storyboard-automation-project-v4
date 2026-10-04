import test from 'node:test';
import assert from 'node:assert/strict';
import { RunStore } from '../src/runs/runStore.js';
import { runStoryboardPipeline } from '../src/storyboardPipeline.js';
import { runIdeaRecovery } from '../src/ideaRecoveryPipeline.js';

test('storyboard failures and reused completion persist owned project activity', async () => {
  const store = new RunStore();
  const script = { id: 'recActivityScript', fields: { video_id: 'activity-video',
    Projects: 'Science', status: 'Approved' } };
  let saved, updates = 0;
  const clients = { gemini: { generate: async () => ({ structure3: [{
    panel_prompt: 'A science experiment.', video_prompt: 'Follow the experiment.' }] }) },
    airtable: { searchScripts: async () => [script], getScript: async () => script,
      findProjectByKey: async () => ({ id: 'recOwned', fields: {} }),
      findStoryboardById: async () => saved,
      upsertStoryboard: async fields => { saved = { id: 'recStory', fields }; return saved; },
      updateScript: async () => { if (++updates === 1) throw new Error('Status unavailable'); script.fields.status = 'Story Generated'; } },
    telegram: { errorAlert: async () => {} } };
  await runStoryboardPipeline({ clients, runStore: store });
  assert.equal(store.list({ projectId: 'recOwned' })[0].status, 'FAILED');
  assert.equal(store.list()[0].items[0].scriptId, script.id);
  await runStoryboardPipeline({ clients, runStore: store });
  const activity = store.list({ projectIds: ['recOwned'] });
  assert.equal(activity.length, 2);
  const completed = activity.find(run => run.status === 'COMPLETED');
  assert.equal(completed.type, 'STORYBOARD'); assert.equal(completed.items[0].generated, false);
  assert.equal(completed.items[0].storyboardId, 'recStory');
  assert.deepEqual(store.list({ projectIds: ['recOther'] }), []);
});

test('recovery failure and existing-script completion persist project activity', async () => {
  const store = new RunStore();
  const idea = { id: 'recActivityIdea', fields: { title: 'Science', Projects: 'Science' } };
  let stored = null, ideaUpdates = 0;
  const clients = { gemini: { generate: async () => { throw new Error('Provider offline'); } },
    airtable: { forEachStuckIdea: async (_filter, _options, visit) => visit(idea),
      findProjectByKey: async () => ({ id: 'recOwned', fields: { project_id: 'Science' } }),
      findScriptByVideoId: async () => stored,
      updateIdea: async () => { ideaUpdates++; } },
    telegram: { errorAlert: async () => {} } };
  await runIdeaRecovery({ clients, runStore: store });
  const failure = store.list()[0];
  assert.equal(failure.type, 'RECOVERY'); assert.equal(failure.status, 'FAILED');
  assert.match(failure.error, /Provider offline/); assert.equal(ideaUpdates, 0);
  stored = { id: 'recExisting', fields: { video_id: `idea_${idea.id}`, title: 'Existing',
    estimated_duration_seconds: 3, voiceover_script: 'Existing narration',
    scenes_json: JSON.stringify([{ scene_number: 1, duration_seconds: 3, narration: 'Existing narration' }]) } };
  await runIdeaRecovery({ clients, runStore: store });
  const completed = store.list().find(run => run.status === 'COMPLETED');
  assert.equal(completed.items[0].generated, false);
  assert.equal(completed.items[0].scriptId, 'recExisting'); assert.equal(ideaUpdates, 1);
});
