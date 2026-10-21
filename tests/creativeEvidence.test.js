import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formFromProject } from '../src/ideaGeneration.js';
import { buildScriptPrompt } from '../src/agents/script/prompt.js';
import { buildIdeaPrompt } from '../src/agents/idea/prompt.js';
import { buildStoryboardPrompt } from '../src/agents/storyboard/prompt.js';
import { SCRIPT_SYSTEM } from '../src/agents/script/system.js';
import { IDEA_SYSTEM } from '../src/agents/idea/system.js';
import { STORYBOARD_SYSTEM } from '../src/agents/storyboard/system.js';
import { SCRIPT_VALIDATION_SYSTEM } from '../src/agents/scriptValidation/system.js';
import { researchAgent } from '../src/agents/research/index.js';
import { ideaAgent } from '../src/agents/idea/index.js';
import { flattenConcept, unflattenIdea } from '../src/transforms.js';
import { researchEvidence, conceptEvidence, UNKNOWN_METRICS } from '../src/utils/evidence.js';

const source = { url: 'https://www.youtube.com/watch?v=abc', title: 'Water demonstration', view_count: 10, provider: 'youtube-data-api', retrieved_at: '2026-10-11T00:00:00Z' };
const form = { NICHE: 'Science', PLATFORM: 'Facebook', 'TARGET AUDIENCE': 'Singapore parents', 'CONTENT STYLE': 'Practical demonstrations', 'CHANNEL NAME (Optional)': 'Singapore Science Channel', 'CHANNEL DESCRIPTION (Optional)': 'Local experiments' };

test('Script prompt uses complete project context for non-US audiences and multiple platforms', () => {
  for (const platform of ['Facebook', 'YouTube Shorts', 'TikTok']) {
    const prompt = buildScriptPrompt({ concept: { title: 'Test' }, form: { ...form, PLATFORM: platform } });
    for (const value of [platform, form.NICHE, form['TARGET AUDIENCE'], form['CONTENT STYLE'], form['CHANNEL NAME (Optional)'], form['CHANNEL DESCRIPTION (Optional)']]) assert.ok(prompt.includes(value));
    assert.match(prompt, /soft_cta may be empty/);
    assert.match(prompt, /suitable static openings are allowed/);
    assert.match(prompt, /Immediate-value/);
  }
});
test('creative instructions preserve all sixteen structures without universal late-payoff or required CTA rules', () => {
  for (const system of [SCRIPT_SYSTEM, IDEA_SYSTEM]) {
    assert.equal((system.match(/STRUCTURE \d{2}:/g) || []).length, 16);
    assert.match(system, /reward placements are examples, not mandatory/);
    assert.doesNotMatch(system, /never receive the full reward|never appears before|never state the answer|Never reveal the answer immediately|Reward is delayed|Exactly 10|exactly 10/);
  }
  assert.doesNotMatch(SCRIPT_SYSTEM, /targeting US audience|must NEVER be a static|MUST feature human emotion/);
  for (const system of [SCRIPT_SYSTEM, SCRIPT_VALIDATION_SYSTEM]) assert.match(system, /CTAs are optional/);
  assert.match(STORYBOARD_SYSTEM, /endings without a CTA/);
  assert.match(buildStoryboardPrompt({ scriptRecord: { fields: { scenes_json: JSON.stringify([{scene_number:1,duration_seconds:3,narration:'An opening'}]), voiceover_script:'An opening', estimated_duration_seconds:3 } } }), /never add a CTA absent/);
  for (const count of [1, 3, 10, 50]) assert.match(buildIdeaPrompt({ research: {}, count }), new RegExp('Exactly ' + count + ' content concepts'));
});
test('canonical observations exclude hallucinated measurements and classify all model analysis as unverified', async () => {
  const report = await researchAgent({ generate: async () => ({ observations: [{ retention: 99 }], growth: 'rising', sentiment: 'positive' }) }, form, { videos: [source] });
  assert.deepEqual(report.unknowns, UNKNOWN_METRICS);
  assert.equal(report.cross_platform_hypothesis, true);
  assert.equal(report.confidence, 'unverified');
  assert.equal(report.observations.length, 1);
  assert.equal(report.observations[0].view_count, 10);
  assert.equal(report.observations[0].retention, undefined);
  assert.equal(report.hypotheses.growth, 'rising');
  const absent = await researchAgent({ generate: async () => ({ growth: 'rising' }) }, form);
  assert.deepEqual(absent.observations, []);
  assert.deepEqual(absent.unknowns, UNKNOWN_METRICS);
});
test('concept count caps model overshoot and evidence survives Airtable text persistence and reconstruction', async () => {
  const context = researchEvidence({ videos: [source] }, form.PLATFORM);
  const concepts = await ideaAgent({ generate: async () => ({ concepts: Array.from({ length: 10 }, (_, i) => ({ title: 'Concept ' + i, review: { strategy_notes: 'Distinct treatment' }, evidence: { observations: [{ view_count: 999999 }], unknowns: [], claims: [{ text: 'This may engage viewers', classification: 'observation', confidence: 'verified', source_urls: [source.url, 'https://invented.test'] }] } })) }) }, { research: context, count: 1 });
  assert.equal(concepts.length, 1);
  const fields = flattenConcept(concepts[0], { form, projectKey: 'science' });
  const restored = unflattenIdea({ id: 'recIdea', fields: JSON.parse(JSON.stringify(fields)) });
  assert.deepEqual(restored.evidence, concepts[0].evidence);
  assert.equal(restored.review.strategy_notes, 'Distinct treatment');
  assert.equal(restored.evidence.observations[0].view_count, 10);
  assert.equal(restored.evidence.claims[0].classification, 'hypothesis');
  assert.equal(restored.evidence.claims[0].confidence, 'unverified');
  assert.deepEqual(restored.evidence.claims[0].source_urls, [source.url]);
  assert.deepEqual(restored.evidence.unknowns, UNKNOWN_METRICS);
  assert.ok(buildScriptPrompt({ concept: restored, form }).includes(source.retrieved_at));
});
test('legacy notes and missing evidence remain usable without fabricated provenance', () => {
  for (const notes of ['plain notes', '{bad json', '{"ordinary":"JSON notes"}', '']) {
    const concept = unflattenIdea({ fields: { strategy_notes: notes } });
    assert.equal(concept.review.strategy_notes, notes);
    assert.equal(concept.evidence, undefined);
  }
  const evidence = conceptEvidence({ claims: [{ text: 'Unknown retention', classification: 'unknown', source_urls: ['https://invented.test'] }] }, researchEvidence(null));
  assert.deepEqual(evidence.observations, []);
  assert.deepEqual(evidence.claims[0].source_urls, []);
  assert.equal(evidence.claims[0].classification, 'unknown');
  assert.deepEqual(evidence.unknowns, UNKNOWN_METRICS);
});


test('manual, scheduled and recovery worker paths receive saved evidence and channel context', async () => {
  const { RunStore } = await import('../src/runs/runStore.js');
  const { TaskQueue } = await import('../src/http/taskQueue.js');
  const { ScriptRunController } = await import('../src/runs/scriptRunController.js');
  const { runIdeaRecovery } = await import('../src/ideaRecoveryPipeline.js');
  const { withScriptValidation } = await import('./helpers/scriptValidation.js');
  const evidence = conceptEvidence({ claims: [{ text: 'Demonstrations may help', classification: 'hypothesis', source_urls: [source.url] }] }, researchEvidence({ videos: [source] }, 'Facebook'));
  const fields = flattenConcept({ title: 'Evidence round trip', review: { strategy_notes: 'Notes' }, evidence }, { form, projectKey: 'Science_Facebook' });
  const project = { id: 'recEvidenceProject', fields: { project_id: 'Science_Facebook', niche: 'Science', platform: 'Facebook', target_audience: form['TARGET AUDIENCE'], content_style: form['CONTENT STYLE'], channel_page_name: form['CHANNEL NAME (Optional)'], description: form['CHANNEL DESCRIPTION (Optional)'] } };
  for (const mode of ['MANUAL', 'SCHEDULED', 'RECOVERY', 'OPERATOR_RECOVERY', 'OPERATOR_RECOVERY_LINKED']) {
    const idea = { id: 'recEvidence' + mode, fields: JSON.parse(JSON.stringify(fields)) };
    if (mode === 'OPERATOR_RECOVERY_LINKED') idea.fields.Projects = [project.id];
    let prompt, validationPrompt, saved;
    const provider = withScriptValidation(async args => {
      prompt = args.prompt;
      return { scripts: [{ video: { video_id: 'model', title: 'Evidence script', estimated_duration_seconds: 15, voiceover: { full_script: 'Narration' }, soft_cta: '' }, scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'A demonstration' }] }] };
    });
    const gemini = { generate: async args => { if (args.system === SCRIPT_VALIDATION_SYSTEM) validationPrompt = args.prompt; return provider.generate(args); } };
    const airtable = { getProject: async () => project, findProjectByKey: async () => project,
      getIdea: async () => idea, forEachEligibleIdea: async (_id, _options, visit) => visit(idea),
      forEachStuckIdea: async (_query, _options, visit) => visit(idea),
      findScriptByVideoId: async () => null, upsertScript: async fields => (saved = { id: 'recScript' + mode, fields }), updateIdea: async () => idea };
    const telegram = { errorAlert: async () => {}, scriptsGeneratedAlert: async () => {} };
    if (mode.startsWith('OPERATOR_RECOVERY')) {
      const result = await runIdeaRecovery({ clients: { gemini, airtable, telegram }, limit: 1 });
      assert.equal(result.recovered, 1);
    } else {
      const store = new RunStore();
      const controller = new ScriptRunController({ store, queue: new TaskQueue({ maxConcurrency: 1, maxQueued: 2 }), makeGemini: () => gemini, makeAirtable: () => airtable, makeTelegram: () => telegram });
      const run = controller.create({ projectId: project.id, mode: 'count', count: 1 }, { source: mode });
      for (let n = 0; n < 200 && ['QUEUED', 'RUNNING'].includes(store.get(run.id).status); n++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(store.get(run.id).status, 'COMPLETED', mode);
    }
    assert.ok(saved, mode);
    for (const value of [source.url, source.retrieved_at, source.provider, form['TARGET AUDIENCE'], form['CONTENT STYLE'], form['CHANNEL NAME (Optional)'], form['CHANNEL DESCRIPTION (Optional)']]) { assert.ok(prompt.includes(value), mode + ' Script: ' + value); assert.ok(validationPrompt.includes(value), mode + ' validation: ' + value); }
  }
});


test('shared project mapping used by cloud recovery preserves channel identity and tolerates missing context', () => {
  const project = { fields: { channel_page_name: 'Cloud Channel', description: 'Cloud description' } };
  const mapped = formFromProject(project);
  assert.equal(mapped['CHANNEL NAME (Optional)'], 'Cloud Channel');
  assert.equal(mapped['CHANNEL DESCRIPTION (Optional)'], 'Cloud description');
  const prompt = buildScriptPrompt({ concept: {}, form: mapped });
  assert.match(prompt, /Cloud Channel/); assert.match(prompt, /Cloud description/);
  const blank = formFromProject(null);
  assert.equal(blank['CHANNEL NAME (Optional)'], '');
  assert.equal(blank['CHANNEL DESCRIPTION (Optional)'], '');
  assert.doesNotThrow(() => buildScriptPrompt({ concept: {}, form: blank }));
});
