import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processIdeaScript, scriptIdForIdea } from '../src/scriptWorker.js';
import { withScriptValidation } from './helpers/scriptValidation.js';

const idea = { id: 'recIdea1', fields: { title: 'Idea' } };
const form = { NICHE: 'Science', PLATFORM: 'YouTube' };
const concept = { title: 'Idea' };
const generated = {
  scripts: [{
    video: {
      video_id: 'unstable-model-id',
      title: 'Generated title',
      estimated_duration_seconds: 30,
      voiceover: { full_script: 'Narration' },
    },
    scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'Scene' }],
  }],
};

function validRecord() {
  return {
    id: 'recScript1',
    fields: {
      video_id: scriptIdForIdea(idea),
      title: 'Generated title',
      voiceover_script: 'Narration',
      estimated_duration_seconds: 30,
      scenes_json: JSON.stringify([{ scene_number: 1, duration_seconds: 3 }]),
    },
  };
}

test('processIdeaScript skips Gemini and persistence when a valid script exists', async () => {
  let generations = 0;
  let writes = 0;
  const existing = validRecord();
  const result = await processIdeaScript({
    idea,
    concept,
    form,
    projectKey: 'Science_YouTube',
    gemini: { generate: async () => { generations += 1; return generated; } },
    airtable: {
      findScriptByVideoId: async () => existing,
      upsertScript: async () => { writes += 1; },
    },
  });

  assert.equal(result.generated, false);
  assert.equal(result.script, existing);
  assert.equal(generations, 0);
  assert.equal(writes, 0);
});

test('processIdeaScript replaces an incomplete row using the deterministic ID', async () => {
  let writtenFields;
  const result = await processIdeaScript({
    idea,
    concept,
    form,
    projectKey: 'Science_YouTube',
    gemini: withScriptValidation(async () => generated),
    airtable: {
      findScriptByVideoId: async () => ({
        id: 'recIncomplete',
        fields: { video_id: scriptIdForIdea(idea), title: '', scenes_json: '[]' },
      }),
      upsertScript: async (fields) => {
        writtenFields = fields;
        return { id: 'recIncomplete', fields, updated: true };
      },
    },
  });

  assert.equal(result.generated, true);
  assert.equal(result.updated, true);
  assert.equal(writtenFields.video_id, 'idea_recIdea1');
  assert.equal(writtenFields.Projects, 'Science_YouTube');
  assert.notEqual(writtenFields.video_id, 'unstable-model-id');
});

test('processIdeaScript regenerates a persisted row that fails the usable-script contract', async () => {
  let generations = 0;
  let writes = 0;
  const incomplete = validRecord();
  incomplete.fields.estimated_duration_seconds = 0;
  const result = await processIdeaScript({
    idea,
    concept,
    form,
    projectKey: 'Science_YouTube',
    gemini: withScriptValidation(async () => { generations += 1; return generated; }),
    airtable: {
      findScriptByVideoId: async () => incomplete,
      upsertScript: async (fields) => {
        writes += 1;
        return { id: incomplete.id, fields, updated: true };
      },
    },
  });

  assert.equal(result.generated, true);
  assert.equal(generations, 1);
  assert.equal(writes, 1);
});

test('retry after an ambiguous write failure finds the first write and does not duplicate', async () => {
  let stored = null;
  let generations = 0;
  let writes = 0;
  const airtable = {
    findScriptByVideoId: async () => stored,
    upsertScript: async (fields) => {
      writes += 1;
      stored = { id: 'recPersisted', fields };
      throw new Error('connection lost after Airtable accepted the write');
    },
  };
  const gemini = withScriptValidation(async () => { generations += 1; return generated; });

  await assert.rejects(processIdeaScript({ idea, concept, form, gemini, airtable }));
  const retry = await processIdeaScript({ idea, concept, form, gemini, airtable });

  assert.equal(retry.generated, false);
  assert.equal(writes, 1);
  assert.equal(generations, 1);
});

test('simultaneous processing of the same idea is serialized and writes once', async () => {
  let stored = null;
  let generations = 0;
  let writes = 0;
  const airtable = {
    findScriptByVideoId: async () => stored,
    upsertScript: async (fields) => {
      writes += 1;
      stored = { id: 'recConcurrent', fields };
      return stored;
    },
  };
  const gemini = withScriptValidation(async () => {
      generations += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return generated;
    });
  const args = { idea, concept, form, gemini, airtable };
  const [first, second] = await Promise.all([
    processIdeaScript(args),
    processIdeaScript(args),
  ]);

  assert.equal(generations, 1);
  assert.equal(writes, 1);
  assert.equal(first.generated, true);
  assert.equal(second.generated, false);
});
