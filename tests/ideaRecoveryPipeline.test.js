import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIdeaRecovery } from '../src/ideaRecoveryPipeline.js';
import { withScriptValidation } from './helpers/scriptValidation.js';

test('recovery can scope Draft ideas to one project key', async () => {
  let filter;
  const result = await runIdeaRecovery({
    clients: {
      gemini: {},
      airtable: { forEachStuckIdea: async (query) => { filter = query; } },
      telegram: {},
    },
    limit: 1,
    projectKeyFilter: 'test"project',
  });
  assert.equal(result.stuck, 0);
  assert.match(filter, /\{Projects\} = "test\\"project"/);
});

test('recovery never persists or completes an idea when Gemini output is unusable', async () => {
  let creates = 0;
  let updates = 0;
  let alerts = 0;
  const idea = {
    id: 'recIdea1',
    fields: { title: 'Recover me', niche: 'Science', platform: 'YouTube' },
  };
  const clients = {
    gemini: { generate: async () => ({ scripts: [] }) },
    airtable: {
      searchIdeas: async () => [idea],
      getProject: async () => null,
      findScriptByVideoId: async () => null,
      upsertScript: async () => { creates += 1; },
      updateIdea: async () => { updates += 1; },
    },
    telegram: {
      errorAlert: async () => { alerts += 1; },
      scriptsGeneratedAlert: async () => {},
    },
  };

  const result = await runIdeaRecovery({ clients, limit: 1 });

  assert.equal(result.recovered, 0);
  assert.equal(creates, 0);
  assert.equal(updates, 0);
  assert.equal(alerts, 1);
});

test('a Telegram outage does not stop recovery from continuing to the next idea', async () => {
  const ideas = [
    { id: 'idea1', fields: { title: 'One', niche: 'Science', platform: 'YouTube' } },
    { id: 'idea2', fields: { title: 'Two', niche: 'Science', platform: 'YouTube' } },
  ];
  let lookups = 0;
  const result = await runIdeaRecovery({
    clients: {
      gemini: { generate: async () => ({ scripts: [] }) },
      airtable: {
        searchIdeas: async () => ideas,
        getProject: async () => null,
        findScriptByVideoId: async () => { lookups += 1; return null; },
        upsertScript: async () => { throw new Error('must not persist'); },
        updateIdea: async () => { throw new Error('must not complete'); },
      },
      telegram: {
        errorAlert: async () => { throw new Error('Telegram offline'); },
        scriptsGeneratedAlert: async () => {},
      },
    },
    limit: 2,
  });
  assert.equal(result.recovered, 0);
  assert.equal(lookups, 2);
});

test('simultaneous recovery runs for the same idea persist one script', async () => {
  const idea = {
    id: 'recIdeaConcurrent',
    fields: { title: 'Recover once', niche: 'Science', platform: 'YouTube' },
  };
  const generated = {
    scripts: [{
      video: {
        video_id: 'model-id',
        title: 'Recovered script',
        estimated_duration_seconds: 30,
        voiceover: { full_script: 'Narration' },
      },
      scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'Scene' }],
    }],
  };
  let stored;
  let generations = 0;
  let writes = 0;
  const clients = {
    gemini: withScriptValidation(async () => {
        generations += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return generated;
      }),
    airtable: {
      searchIdeas: async () => [idea],
      getProject: async () => null,
      findScriptByVideoId: async () => stored || null,
      upsertScript: async (fields) => {
        writes += 1;
        stored = { id: 'recScript1', fields };
        return stored;
      },
      updateIdea: async () => idea,
    },
    telegram: {
      errorAlert: async () => {},
      scriptsGeneratedAlert: async () => {},
    },
  };

  const [first, second] = await Promise.all([
    runIdeaRecovery({ clients, limit: 1 }),
    runIdeaRecovery({ clients, limit: 1 }),
  ]);

  assert.equal(generations, 1);
  assert.equal(writes, 1);
  assert.equal(first.recovered + second.recovered, 1);
});

test('recovery resolves a scalar project key and saves it on the script', async () => {
  const idea = { id: 'recIdeaScalar', fields: {
    title: 'Recover scalar', niche: 'Science', platform: ['YouTube'], Projects: 'Science_YouTube',
  } };
  let lookedUp;
  let savedFields;
  const result = await runIdeaRecovery({
    clients: {
      gemini: withScriptValidation(async () => ({ scripts: [{
        video: { video_id: 'model-id', title: 'Recovered', estimated_duration_seconds: 30, voiceover: { full_script: 'Narration' } },
        scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'Scene' }],
      }] })),
      airtable: {
        searchIdeas: async () => [idea],
        findProjectByKey: async (key) => {
          lookedUp = key;
          return { id: 'recProject1', fields: { project_id: key, niche: 'Science' } };
        },
        findScriptByVideoId: async () => null,
        upsertScript: async (fields) => { savedFields = fields; return { id: 'recScript1', fields }; },
        updateIdea: async () => idea,
      },
      telegram: { errorAlert: async () => {}, scriptsGeneratedAlert: async () => {} },
    },
    limit: 1,
  });
  assert.equal(result.recovered, 1);
  assert.equal(lookedUp, 'Science_YouTube');
  assert.equal(savedFields.Projects, 'Science_YouTube');
  assert.equal(savedFields.platform_input, 'YouTube');
});
