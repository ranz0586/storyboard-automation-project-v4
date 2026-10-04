import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStoryboardPipeline } from '../src/storyboardPipeline.js';

test('storyboard poll can scope approved scripts to one project key', async () => {
  let filter;
  const result = await runStoryboardPipeline({
    clients: {
      gemini: {},
      airtable: { searchScripts: async (query) => { filter = query; return []; } },
      telegram: {},
    },
    projectKeyFilter: 'test"project',
  });
  assert.equal(result.polled, 0);
  assert.match(filter, /\{Projects\} = "test\\"project"/);
});

const approved = {
  id: 'recScript1',
  fields: { video_id: 'video-1', title: 'Approved', status: 'Approved' },
};
const valid = { master_assets: {}, structure1: [{ image_prompt: 'Water refracts light through a glass.', video_prompt: 'Track the light moving through water.' }] };
const reads = { getScript: async () => structuredClone(approved), findStoryboardById: async () => null };

test('storyboard pipeline persists an omitted structure3 safely and completes the script', async () => {
  let savedFields;
  let updatedStatus;
  const result = await runStoryboardPipeline({
    clients: {
      gemini: { generate: async () => valid },
      airtable: {
        ...reads,
        searchScripts: async () => [approved],
        upsertStoryboard: async (fields) => {
          savedFields = fields;
          return { id: 'recStoryboard1', fields };
        },
        updateScript: async (_id, fields) => { updatedStatus = fields.status; },
      },
      telegram: { errorAlert: async () => {} },
    },
  });
  assert.equal(result.generated, 1);
  assert.equal(savedFields.structure3_json, '[]');
  assert.deepEqual(JSON.parse(savedFields.storyboard_text), valid);
  assert.equal(updatedStatus, 'Story Generated');
});

test('malformed storyboard structure3 is not persisted or marked generated', async () => {
  let writes = 0;
  let updates = 0;
  let alerts = 0;
  const result = await runStoryboardPipeline({
    clients: {
      gemini: { generate: async () => ({ master_assets: {}, structure3: 'invalid' }) },
      airtable: {
        ...reads,
        searchScripts: async () => [approved],
        upsertStoryboard: async () => { writes += 1; },
        updateScript: async () => { updates += 1; },
      },
      telegram: { errorAlert: async () => { alerts += 1; } },
    },
  });
  assert.equal(result.generated, 0);
  assert.equal(writes, 0);
  assert.equal(updates, 0);
  assert.equal(alerts, 1);
});

test('storyboard resolves the live scalar project key before generating', async () => {
  const lookedUp = [];
  let saved;
  const result = await runStoryboardPipeline({
    clients: {
      gemini: { generate: async () => valid },
      airtable: {
        ...reads,
        getScript: async () => ({ ...approved, fields: { ...approved.fields, Projects: 'Parenting_Facebook' } }),
        searchScripts: async () => [{ ...approved, fields: { ...approved.fields, Projects: 'Parenting_Facebook' } }],
        findProjectByKey: async (key) => {
          lookedUp.push(key);
          return { id: 'recProject1', fields: { project_id: key, niche: 'Parenting' } };
        },
        upsertStoryboard: async (fields) => { saved = fields; return { id: 'recStoryboard1' }; },
        updateScript: async () => {},
      },
      telegram: { errorAlert: async () => {} },
    },
  });
  assert.equal(result.generated, 1);
  assert.deepEqual(lookedUp, ['Parenting_Facebook']);
  assert.equal(saved.storyboard_id, 'video-1');
});

function retryFixture({ failure } = {}) {
  let script = structuredClone(approved), saved = null;
  const calls = { generations: 0, writes: 0, updates: 0, alerts: 0 };
  const clients = {
    gemini: { generate: async () => { calls.generations++; return structuredClone(valid); } },
    airtable: {
      searchScripts: async () => script.fields.status === 'Approved' ? [structuredClone(script)] : [],
      getScript: async () => structuredClone(script),
      findStoryboardById: async () => structuredClone(saved),
      upsertStoryboard: async fields => {
        calls.writes++; saved = { id: 'recStoryboard', fields };
        if (failure === 'ambiguous' && calls.writes === 1) throw new Error('Response lost after write');
        return structuredClone(saved);
      },
      updateScript: async (_id, fields) => {
        calls.updates++;
        if (failure === 'status' && calls.updates === 1) throw new Error('Status write failed');
        Object.assign(script.fields, fields);
      },
    },
    telegram: { errorAlert: async () => { calls.alerts++; } },
  };
  return { clients, calls, replaceSaved: value => { saved = value; } };
}

test('empty and promptless storyboards never write or advance Script status', async () => {
  for (const output of [{}, { master_assets: {} }, { structure3: [{}] },
    { structure2: [{ panel_prompt: 'Visual', video_prompt: ' ' }] }]) {
    const fixture = retryFixture();
    fixture.clients.gemini.generate = async () => output;
    const result = await runStoryboardPipeline({ clients: fixture.clients });
    assert.equal(result.generated, 0);
    assert.equal(fixture.calls.writes, 0);
    assert.equal(fixture.calls.updates, 0);
    assert.equal(fixture.calls.alerts, 1);
  }
});

test('storyboard retry completes persisted output without regenerating after ambiguous/status failures', async () => {
  for (const failure of ['ambiguous', 'status']) {
    const { clients, calls } = retryFixture({ failure });
    assert.equal((await runStoryboardPipeline({ clients })).generated, 0);
    const retry = await runStoryboardPipeline({ clients });
    assert.equal(retry.generated, 1, 'the reused package completes the lifecycle');
    assert.equal(retry.results[0].generated, false);
    assert.equal(calls.generations, 1);
    assert.equal(calls.writes, 1);
  }
});

test('simultaneous pollers re-read under the lock and generate once', async () => {
  const { clients, calls } = retryFixture();
  await Promise.all([runStoryboardPipeline({ clients }), runStoryboardPipeline({ clients })]);
  assert.equal(calls.generations, 1);
  assert.equal(calls.writes, 1);
  assert.equal(calls.updates, 1);
});

test('unusable or wrong-identity persisted storyboards are regenerated', async () => {
  for (const fields of [{ storyboard_id: 'video-1', storyboard_text: '{}' },
    { storyboard_id: 'other', storyboard_text: JSON.stringify(valid) }]) {
    const fixture = retryFixture();
    fixture.replaceSaved({ id: 'recBad', fields });
    assert.equal((await runStoryboardPipeline({ clients: fixture.clients })).generated, 1);
    assert.equal(fixture.calls.generations, 1);
  }
});
