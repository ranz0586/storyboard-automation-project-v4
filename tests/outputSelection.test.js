import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BriefStore } from '../src/briefs/briefStore.js';
import { BriefSettingsSchema, snapshotBrief } from '../src/briefs/contract.js';
import { DEFAULT_PACKS, guidanceFor } from '../src/creativeGuidance/index.js';
import { STRUCTURE_KEYS } from '../shared/storyboardStructures.js';
import { storyboardAgent } from '../src/agents/storyboard/index.js';
import { processIdeaScript } from '../src/scriptWorker.js';
import { processScriptStoryboard } from '../src/storyboardWorker.js';
import { scriptValidationAgent } from '../src/agents/scriptValidation/index.js';
import { SCRIPT_SYSTEM } from '../src/agents/script/system.js';
import { assertUsableStoryboard } from '../src/utils/storyboardValidation.js';
import { flattenStoryboard } from '../src/transforms.js';
import { storyboardReply } from './helpers/storyboard.js';
import { validationReply, scriptFromValidationPrompt } from './helpers/scriptValidation.js';

const form = { NICHE: 'Science', PLATFORM: 'YouTube', 'TARGET AUDIENCE': 'Original audience', 'CHANNEL NAME (Optional)': 'Original channel', 'STYLE REFERENCES': ['Illustrated reference'] };
export const generatedScript = () => ({ video: { video_id: 'model-video', title: 'Glass experiment', estimated_duration_seconds: 3, voiceover: { full_script: 'This simple experiment reveals how water changes under pressure.' } }, scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'This simple experiment reveals how water changes under pressure.', visual: { description: 'Water in a glass.', image_prompt: 'A glass.', video_prompt: 'Watch water.' } }] });
const scriptRecord = () => ({ id: 'recScript', fields: { status: 'Approved', Projects: 'science', video_id: 'idea_recInput', estimated_duration_seconds: 3, voiceover_script: generatedScript().scenes[0].narration, scenes_json: JSON.stringify(generatedScript().scenes) } });
const project = { id: 'recProject', fields: { project_id: 'science', niche: 'Science', platform: 'YouTube' } };
const withLock = async (_id, work) => work();
const combinations = Array.from({ length: 7 }, (_, index) => STRUCTURE_KEYS.filter((_, bit) => (index + 1) & (1 << bit)));

test('settings accept all seven combinations, normalize ordering and reject unsupported or empty choices', () => {
  for (const structures of combinations) assert.deepEqual(BriefSettingsSchema.parse({ structures: [...structures].reverse() }).structures, structures);
  assert.deepEqual(BriefSettingsSchema.parse({}).structures, STRUCTURE_KEYS);
  assert.deepEqual(BriefSettingsSchema.parse({ structures: 'all' }).structures, STRUCTURE_KEYS);
  for (const input of [{ structures: [] }, { structures: ['structure4'] }, { structures: ['structure1','structure1'] }, { structures: ['structure1'], guidancePacks: [] }, { workflow: 'music-video' }, { audio: 'silent' }, { entry: 'script' }, { durationSeconds: 4 }, { durationSeconds: 301 }, { durationSeconds: 5.5 }, { durationSeconds: '30' }, { language: 'x'.repeat(101) }, { characterReferences: 'x'.repeat(3001) }, { styleReferences: 'x'.repeat(3001) }]) assert.equal(BriefSettingsSchema.safeParse(input).success, false);
});

test('every selected combination controls agent prompt, persisted formats and strict coverage', async () => {
  const script = scriptRecord();
  for (const structures of combinations) {
    const brief = snapshotBrief('science', script.fields.video_id, form, { structures, language: 'English', durationSeconds: 30, characterReferences: 'Blue coat', styleReferences: 'Ink' }, 'script');
    const output = await storyboardAgent({ generate: async ({ system, prompt }) => {
      assert.ok(system.includes('Generate ONLY these structure keys: ' + structures.join(', ')));
      assert.ok(prompt.includes('FROZEN PRODUCTION BRIEF:'));
      assert.ok(prompt.includes('Blue coat')); assert.ok(prompt.includes('Ink'));
      assert.ok(prompt.includes('Storyboard conversion preserves approved narration'));
      return storyboardReply(script);
    } }, { scriptRecord: script, projectRecord: project, brief });
    assert.deepEqual(STRUCTURE_KEYS.filter(key => output[key]?.length), structures);
    assert.doesNotThrow(() => assertUsableStoryboard(output, script, { structures }));
    const fields = flattenStoryboard(output, script, project);
    for (const key of STRUCTURE_KEYS) assert.equal(JSON.parse(fields[key + '_json']).length > 0, structures.includes(key));
    assert.equal(fields.structure_type, structures.includes('structure3') ? 'Structure 3' : structures.includes('structure2') ? 'Structure 2' : 'Structure 1');
    const absent = { ...output }; delete absent[structures[0]];
    assert.throws(() => assertUsableStoryboard(absent, script, { structures }), /selected structure/);
  }
  const brief = snapshotBrief('science', script.fields.video_id, form, { structures: ['structure2'] }, 'script');
  const bad = storyboardReply(script); bad.structure2[0].keyframes = [2];
  assert.throws(() => assertUsableStoryboard({ structure2: bad.structure2 }, script, brief), /Storyboard fidelity/);
  await assert.rejects(storyboardAgent({ generate: async () => ({ structure1: storyboardReply(script).structure1 }) }, { scriptRecord: script, brief }), /selected structure/);
});

test('failed Script generation freezes formats, project identity and guidance across restart and retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-outputs-'));
  try {
    const filePath = path.join(dir, 'briefs.json');
    let store = new BriefStore({ filePath }); store.set('science', { structures: ['structure2'], language: 'English', durationSeconds: 30, characterReferences: 'Blue coat', styleReferences: 'Ink illustration' });
    let failed = false, saved;
    const calls = [];
    const gemini = { generate: async args => {
      calls.push(args);
      if (!failed) { failed = true; throw new Error('Provider unavailable'); }
      return args.system === SCRIPT_SYSTEM ? { scripts: [generatedScript()] } : validationReply(scriptFromValidationPrompt(args.prompt));
    } };
    const airtable = { findScriptByVideoId: async () => saved || null, upsertScript: async fields => saved = { id: 'recScript', fields } };
    const input = { idea: { id: 'recInput' }, concept: { title: 'Glass' }, form, projectKey: 'science', gemini, airtable, withLock };
    await assert.rejects(processIdeaScript({ ...input, briefStore: store }), /Provider unavailable/);
    store = new BriefStore({ filePath }); store.set('science', { structures: ['structure1'], language: 'French', durationSeconds: 60, characterReferences: 'Red coat', styleReferences: 'Watercolor' });
    await processIdeaScript({ ...input, form: { ...form, 'TARGET AUDIENCE': 'Changed audience' }, briefStore: store });
    const frozen = store.get('science', 'idea_recInput');
    assert.deepEqual(frozen.structures, ['structure2']); assert.deepEqual(frozen.guidancePacks, DEFAULT_PACKS);
    assert.equal(frozen.identity.audience, 'Original audience');
    assert.equal(frozen.language, 'English'); assert.equal(frozen.durationSeconds, 30);
    assert.equal(frozen.characterReferences, 'Blue coat'); assert.equal(frozen.styleReferences, 'Ink illustration');
    for (const call of calls) { assert.ok(call.prompt.includes('Original audience')); assert.ok(call.prompt.includes('Blue coat')); assert.ok(call.prompt.includes('Ink illustration')); assert.ok(call.prompt.includes('A requested duration is a planning target')); assert.ok(call.prompt.includes('\"language\":\"English\"')); }
    assert.equal(calls.some(call => call.prompt.includes('Changed audience')), false);
    const before = calls.length; await processIdeaScript({ ...input, briefStore: store }); assert.equal(calls.length, before);
    assert.deepEqual(store.freeze('science', 'idea_new', form).structures, ['structure1']);
    assert.equal(saved.fields.status, 'Draft');
    assert.ok(JSON.parse(saved.fields.scenes_json)[0].editorial_review.summary.hook_fulfilled);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('both validation attempts use frozen guidance and retain complete claim/editorial acceptance', async () => {
  const script = generatedScript(), brief = snapshotBrief('science', 'v', form, { language: 'English', durationSeconds: 30, characterReferences: 'Blue coat' }, 'script');
  const prompts = []; let calls = 0;
  const result = await scriptValidationAgent({ generate: async ({ prompt }) => {
    prompts.push(prompt); const reply = validationReply(scriptFromValidationPrompt(prompt)); calls++;
    if (calls === 1) { reply.approved = false; reply.issues = ['Review again']; }
    return reply;
  } }, { script, concept: {}, form: { ...form, 'PRODUCTION BRIEF': brief } });
  assert.equal(calls, 2);
  for (const prompt of prompts) { assert.ok(prompt.includes('truthful-hooks@1')); assert.ok(prompt.includes('Never approve merely because the writer used this guidance')); assert.ok(prompt.includes('Cite only supplied evidence')); assert.ok(prompt.includes('Blue coat')); assert.ok(prompt.includes('\"durationSeconds\":30'));  }
  assert.ok(result.scenes[0].editorial_review);
  for (const role of ['script','validation','storyboard']) assert.ok(guidanceFor(role, brief).includes('Application schemas, deterministic timing'));
  assert.throws(() => guidanceFor('script', { ...brief, guidancePacks: ['missing@2'] }), /Unavailable frozen/);
});

test('storyboard save/status retry keeps the Script snapshot and never regenerates a faithful cache', async () => {
  const script = scriptRecord(), store = new BriefStore(); store.set('science', { structures: ['structure2'] });
  const frozen = store.freeze('science', script.fields.video_id, form);
  store.set('science', { structures: ['structure1'] });
  let saved, generated = 0, failedStatus = false;
  const clients = { briefStore: store, gemini: { generate: async () => { generated++; return storyboardReply(script); } }, airtable: {
    getScript: async () => script, findProjectByKey: async () => project, findStoryboardById: async () => saved || null,
    upsertStoryboard: async fields => saved = { id: 'recBoard', fields },
    updateScript: async () => { if (!failedStatus) { failedStatus = true; throw new Error('Lost status write'); } },
  } };
  await assert.rejects(processScriptStoryboard({ scriptRecord: script, clients, withLock }), /Lost status write/);
  await processScriptStoryboard({ scriptRecord: script, clients, withLock });
  assert.equal(generated, 1);
  const output = JSON.parse(saved.fields.storyboard_text);
  assert.deepEqual(output.production_brief, frozen);
  assert.deepEqual(STRUCTURE_KEYS.filter(key => output[key]?.length), ['structure2']);
});

test('legacy cached work is reused without claiming new guidance; new legacy conversion has truthful provenance', async () => {
  const script = scriptRecord(), store = new BriefStore(); store.set('science', { structures: ['structure1'] });
  let saved = { id: 'legacy', fields: { storyboard_id: script.fields.video_id, storyboard_text: JSON.stringify({ structure2: storyboardReply(script).structure2 }) } };
  let calls = 0;
  const clients = { briefStore: store, gemini: { generate: async () => { calls++; return storyboardReply(script); } }, airtable: {
    getScript: async () => script, findProjectByKey: async () => project, findStoryboardById: async () => saved,
    upsertStoryboard: async fields => saved = { id: 'new', fields }, updateScript: async () => {},
  } };
  await processScriptStoryboard({ scriptRecord: script, clients, withLock });
  assert.equal(calls, 0); assert.equal(store.get('science', script.fields.video_id), null);
  saved = null; await processScriptStoryboard({ scriptRecord: script, clients, withLock });
  assert.equal(calls, 1); assert.equal(JSON.parse(saved.fields.storyboard_text).production_brief.origin, 'legacy-storyboard');
});

test('brief defaults merge partial writes without changing legacy frozen payloads', () => {
  const store = new BriefStore();
  assert.equal(store.defaults('science').durationSeconds, null);
  store.set('science', { language: ' English ', durationSeconds: 30, characterReferences: ' Blue coat ', styleReferences: ' Ink ' });
  store.set('science', { structures: ['structure2'] });
  const settings = store.defaults('science');
  assert.equal(settings.language, 'English'); assert.equal(settings.characterReferences, 'Blue coat'); assert.equal(settings.durationSeconds, 30);
  const legacy = { version: 1, workflow: 'narrated-video', structures: ['structure3'], identity: { niche: 'Science' }, guidancePacks: DEFAULT_PACKS, origin: 'script' };
  store.state.transaction(state => { state.items[JSON.stringify(['science','old-video'])] = legacy; });
  assert.deepEqual(store.freeze('science','old-video',form), legacy);
  assert.equal(store.get('science','old-video').language, undefined);
  store.set('science', { language: '', durationSeconds: null, characterReferences: '', styleReferences: '' });
  assert.equal(store.defaults('science').language, ''); assert.equal(store.defaults('science').durationSeconds, null);
  assert.deepEqual(store.defaults('science').structures, ['structure2']);
});
