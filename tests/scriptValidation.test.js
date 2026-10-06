import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScriptTiming, spokenWords } from '../src/utils/scriptTiming.js';
import { scriptValidationAgent } from '../src/agents/scriptValidation/index.js';
import { SCRIPT_VALIDATION_SYSTEM } from '../src/agents/scriptValidation/system.js';
import { SCRIPT_SYSTEM } from '../src/agents/script/system.js';
import { processIdeaScript } from '../src/scriptWorker.js';
import { ScriptRunController } from '../src/runs/scriptRunController.js';
import { RunStore } from '../src/runs/runStore.js';
import { TaskQueue } from '../src/http/taskQueue.js';
import { runIdeaRecovery } from '../src/ideaRecoveryPipeline.js';
import { runContentPipeline } from '../src/pipeline.js';
import { RESEARCH_SYSTEM } from '../src/agents/research/system.js';
import { IDEA_SYSTEM } from '../src/agents/idea/system.js';
import { scriptFromValidationPrompt } from './helpers/scriptValidation.js';

const nineWords = 'This simple experiment reveals how water changes under pressure.';
function scene(number = 1, narration = nineWords, duration = 3) {
  return { scene_number: number, duration_seconds: duration, narration, tts: { pause_before_ms: 0, pause_after_ms: 0 },
    visual: { description: 'An experiment shows water changing under pressure.', image_prompt: 'Water in a transparent pressure chamber.', video_prompt: 'Water changes under pressure inside a chamber.' } };
}
function script(scenes = [scene()]) {
  return { video: { video_id: 'video-original', title: 'Water experiment', estimated_duration_seconds: scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0),
    voiceover: { full_script: scenes.map(scene => scene.narration).join(' ') } }, scenes };
}
function reply(candidate) {
  return { approved: true, script: candidate, issues: [], scene_reviews: candidate.scenes.map(scene => ({ scene_number: scene.scene_number,
    visuals_match_narration: true, single_visual_moment: true, reason: 'The pressure chamber depicts the narrated experiment.' })) };
}
const context = { concept: { title: 'Water experiment' }, form: { NICHE: 'Science', PLATFORM: 'YouTube' } };

test('observed nested review shape is normalized without inferring approval or bypassing timing', async () => {
  const output = reply(script());
  output.script.scene_reviews = output.scene_reviews;
  output.script.issues = output.issues;
  delete output.scene_reviews; delete output.issues;
  const validated = await scriptValidationAgent({ generate: async () => structuredClone(output) }, { script: script(), ...context });
  assert.equal(inspectScriptTiming(validated).issues.length, 0);
  const rejected = structuredClone(output); delete rejected.approved;
  await assert.rejects(scriptValidationAgent({ generate: async () => rejected }, { script: script(), ...context }), /approved/);
});

test('malformed semantic review gets one correction opportunity and cannot persist by default', async () => {
  let calls = 0;
  const validated = await scriptValidationAgent({ generate: async ({ prompt }) => {
    calls++;
    if (calls === 1) return { approved: true, script: script() };
    assert.match(prompt, /Output scene_reviews: Required/);
    return reply(script());
  } }, { script: script(), ...context });
  assert.equal(calls, 2); assert.equal(inspectScriptTiming(validated).issues.length, 0);
});

test('three-second narration accepts eight or nine words and rejects ten or fourteen', () => {
  for (const count of [8, 9, 10, 14]) {
    const narration = Array(count).fill('water').join(' ');
    const timing = inspectScriptTiming(script([scene(1, narration)]));
    assert.equal(timing.issues.length === 0, count <= 9);
    assert.equal(timing.scenes[0].max_words, 9);
  }
});

test('two-second scenes and fractional pauses enforce both WPM bounds without rounding away violations', () => {
  for (const [duration, count, pause, valid] of [[2, 5, 0, true], [2, 6, 0, true], [2, 7, 0, false], [3, 7, 0, false], [3, 8, 100, true], [3, 9, 100, false]]) {
    const item = scene(1, Array(count).fill('water').join(' '), duration);
    item.tts.pause_after_ms = pause;
    assert.equal(inspectScriptTiming(script([item])).issues.length === 0, valid);
  }
});

test('voiceover must match scene narration in order rather than only matching word counts', () => {
  const candidate = script([scene(1), scene(2, 'Watch the tiny bubbles rise inside the clear chamber.')]);
  candidate.video.voiceover.full_script = candidate.scenes.toReversed().map(scene => scene.narration).join(' ');
  assert.match(inspectScriptTiming(candidate).issues.join(';'), /Full voiceover/);
  candidate.video.voiceover.full_script = candidate.scenes.map(scene => scene.narration).join(' ');
  candidate.video.estimated_duration_seconds = 30;
  assert.match(inspectScriptTiming(candidate).issues.join(';'), /Video duration/);
});

test('timing checks reject invalid durations, pauses, numbering, visuals, markup and unexpanded numbers', () => {
  for (const mutate of [
    s => { s.scenes[0].duration_seconds = 0; },
    s => { s.scenes[0].duration_seconds = -3; },
    s => { s.scenes[0].duration_seconds = Infinity; },
    s => { s.scenes[0].scene_number = 2; },
    s => { s.scenes[0].tts.pause_before_ms = -100; },
    s => { s.scenes[0].tts.pause_before_ms = '100'; },
    s => { s.scenes[0].tts.pause_after_ms = 3000; },
    s => { s.scenes[0].visual.video_prompt = ''; },
    s => { s.scenes[0].narration = '<break/> This experiment changes water.'; },
    s => { s.scenes[0].narration = '2026 water pressure experiment.'; },
  ]) {
    const candidate = script(); mutate(candidate);
    assert.ok(inspectScriptTiming(candidate).issues.length);
  }
});

test('spoken token counting handles punctuation, contractions and deliberate silent visual beats', () => {
  assert.deepEqual(spokenWords("Don't rush—it's water’s pressure."), ["don't", 'rush', "it's", "water's", 'pressure']);
  const candidate = script([scene(1), scene(2, '')]);
  assert.equal(inspectScriptTiming(candidate).issues.length, 0);
});

test('validation repairs narration, visuals and total duration before returning the canonical script', async () => {
  const overcrowded = script([scene(1, 'This experiment has far too many words for a tiny three second scene.')]);
  const corrected = script([scene(1), scene(2)]);
  let calls = 0;
  const result = await scriptValidationAgent({ generate: async args => {
    calls++;
    assert.equal(args.system, SCRIPT_VALIDATION_SYSTEM);
    assert.ok(args.json);
    assert.match(args.prompt, /180 WPM|150 and 180 WPM/);
    assert.match(args.prompt, /allowed 150/);
    return reply(corrected);
  } }, { ...context, script: overcrowded });
  assert.equal(calls, 1);
  assert.equal(result.scenes.length, 2);
  assert.equal(result.video.estimated_duration_seconds, 6);
  assert.equal(result.video.voiceover.full_script, `${nineWords} ${nineWords}`);
  assert.equal(result.scenes[0].tts.speaking_rate_wpm, 180);
});

test('false approval cannot bypass timing checks and only one correction request is allowed', async () => {
  const bad = script([scene(1, Array(14).fill('water').join(' '))]);
  let calls = 0;
  await assert.rejects(scriptValidationAgent({ generate: async args => {
    calls++;
    if (calls === 2) assert.match(args.prompt, /PREVIOUS VALIDATION ISSUES TO RESOLVE:[\s\S]*allowed 150/);
    return reply(bad);
  } }, { ...context, script: bad }), /Script validation failed:.*WPM/);
  assert.equal(calls, 2);
});

test('a correction pass may fix the rejected first review without generating another script', async () => {
  let calls = 0;
  const good = script();
  const result = await scriptValidationAgent({ generate: async () => {
    calls++;
    const output = reply(good);
    if (calls === 1) output.scene_reviews[0].visuals_match_narration = false;
    return output;
  } }, { ...context, script: good });
  assert.equal(calls, 2);
  assert.equal(result.scenes[0].narration, nineWords);
});

test('missing, duplicated, mismatched and rejected visual reviews cannot pass', async () => {
  for (const mutate of [
    result => { result.approved = false; result.issues = ['Unsupported visual claim']; },
    result => { result.scene_reviews = []; },
    result => { result.scene_reviews[0].scene_number = 99; },
    result => { result.scene_reviews.push(result.scene_reviews[0]); },
    result => { result.scene_reviews[0].visuals_match_narration = false; },
    result => { result.scene_reviews[0].single_visual_moment = false; },
    result => { result.script.video.voiceover.full_script = 'Other narration entirely.'; },
    result => { result.script.video.estimated_duration_seconds = 10; },
    result => { result.script = script([scene(1, Array(27).fill('water').join(' '), 9)]); },
  ]) {
    await assert.rejects(scriptValidationAgent({ generate: async () => { const output = reply(script()); mutate(output); return output; } }, { ...context, script: script() }), /Script validation failed/);
  }
});

test('validator failure or unusable output stops persistence even when script generation succeeded', async () => {
  for (const fail of ['outage', 'malformed', 'timing', 'visual']) {
    let writes = 0, generations = 0, validations = 0;
    await assert.rejects(processIdeaScript({ ...context, idea: { id: `recRejected-${fail}` },
      gemini: { generate: async ({ system }) => {
        if (system === SCRIPT_SYSTEM) { generations++; return { scripts: [script()] }; }
        validations++;
        if (fail === 'outage') throw new Error('Validator unavailable');
        if (fail === 'malformed') return {};
        const output = reply(script());
        if (fail === 'timing') output.script = script([scene(1, Array(14).fill('water').join(' '))]);
        if (fail === 'visual') output.scene_reviews[0].visuals_match_narration = false;
        return output;
      } },
      airtable: { findScriptByVideoId: async () => null, upsertScript: async () => { writes++; } },
    }));
    assert.equal(generations, 1); assert.ok(validations >= 1); assert.equal(writes, 0);
  }
});

test('manual and scheduled runs leave Ideas Draft and expose validation errors without saving', async () => {
  for (const source of ['MANUAL', 'SCHEDULED']) {
    const store = new RunStore();
    let writes = 0, updates = 0;
    const idea = { id: `recBad-${source}`, fields: { title: 'Water', Projects: 'Science_YouTube', 'Idea Status': 'Draft' } };
    const controller = new ScriptRunController({ store, queue: new TaskQueue({ maxConcurrency: 1, maxQueued: 2 }),
      makeGemini: () => ({ generate: async ({ system }) => system === SCRIPT_SYSTEM ? { scripts: [script()] }
        : { ...reply(script()), approved: false, issues: ['Visuals contradict narration'] } }),
      makeAirtable: () => ({ getProject: async () => ({ id: 'recProject', fields: { project_id: 'Science_YouTube', status: 'Active' } }),
        getIdea: async () => idea, forEachEligibleIdea: async (_id, _options, visit) => { await visit(idea); },
        findScriptByVideoId: async () => null, upsertScript: async () => { writes++; }, updateIdea: async () => { updates++; } }),
      makeTelegram: () => ({ errorAlert: async () => {} }),
    });
    const run = controller.create({ projectId: 'recProject', mode: 'count', count: 1 }, { source });
    for (let i = 0; i < 100 && ['QUEUED', 'RUNNING'].includes(store.get(run.id).status); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const result = store.get(run.id);
    assert.equal(result.status, 'FAILED'); assert.equal(result.failedCount, 1);
    assert.match(result.items[0].error, /Script validation failed/);
    assert.equal(writes, 0); assert.equal(updates, 0);
  }
});

test('recovery also refuses validation failures and leaves the Idea eligible for retry', async () => {
  let writes = 0, updates = 0;
  const result = await runIdeaRecovery({ clients: {
    gemini: { generate: async ({ system }) => system === SCRIPT_SYSTEM ? { scripts: [script()] }
      : { ...reply(script()), approved: false, issues: ['Narration does not match visuals'] } },
    airtable: { searchIdeas: async () => [{ id: 'recRecoveryBad', fields: { title: 'Water', 'Idea Status': 'Draft' } }],
      findScriptByVideoId: async () => null, upsertScript: async () => { writes++; }, updateIdea: async () => { updates++; } },
    telegram: { errorAlert: async () => {} },
  }, limit: 1 });
  assert.equal(result.recovered, 0); assert.equal(writes, 0); assert.equal(updates, 0);
});

test('shared worker saves the corrected script only after both agents complete', async () => {
  const order = [];
  const corrected = script([scene(1), scene(2)]);
  const result = await processIdeaScript({ ...context, idea: { id: 'recCorrected' },
    gemini: { generate: async ({ system, prompt }) => {
      if (system === SCRIPT_SYSTEM) { order.push('script'); return { scripts: [script()] }; }
      order.push('validation'); assert.equal(scriptFromValidationPrompt(prompt).video.title, 'Water experiment');
      return reply(corrected);
    } },
    airtable: { findScriptByVideoId: async () => null, upsertScript: async fields => { order.push('save');
      assert.equal(fields.estimated_duration_seconds, 6);
      assert.equal(fields.voiceover_script, `${nineWords} ${nineWords}`);
      assert.equal(JSON.parse(fields.scenes_json).length, 2);
      return { id: 'recSaved', fields }; } },
  });
  assert.deepEqual(order, ['script', 'validation', 'save']);
  assert.equal(result.generated, true);
});

test('operator content pipeline validates before saving and never completes a rejected Idea', async () => {
  for (const approved of [true, false]) {
    let writes = 0, updates = 0, successAlerts = 0, errorAlerts = 0;
    const result = await runContentPipeline({ form: context.form, clients: { conceptCount: 1,
      gemini: { generate: async ({ system }) => {
        if (system === RESEARCH_SYSTEM) return { report: 'Research' };
        if (system === IDEA_SYSTEM) return { concepts: [context.concept] };
        if (system === SCRIPT_SYSTEM) return { scripts: [script()] };
        if (system === SCRIPT_VALIDATION_SYSTEM) return { ...reply(script()), approved, issues: approved ? [] : ['Scene visuals conflict with narration'] };
        return []; // No Trend Scout queries, therefore no yt-dlp calls.
      } },
      airtable: { upsertProject: async fields => ({ id: 'recProject', fields }),
        upsertIdea: async fields => ({ id: `recPipelineValidation-${approved}`, fields }),
        findScriptByVideoId: async () => null,
        upsertScript: async fields => { writes++; assert.equal(JSON.parse(fields.scenes_json)[0].tts.speaking_rate_wpm, 180); return { id: 'recScript', fields }; },
        updateIdea: async (_id, fields) => { updates++; assert.equal(fields['Idea Status'], 'Script Generated'); },
      },
      telegram: { errorAlert: async () => { errorAlerts++; }, scriptsGeneratedAlert: async () => { successAlerts++; } },
    } });
    assert.equal(result.scriptCount, approved ? 1 : 0);
    assert.equal(writes, approved ? 1 : 0); assert.equal(updates, approved ? 1 : 0);
    assert.equal(successAlerts, approved ? 1 : 0); assert.equal(errorAlerts, approved ? 0 : 1);
  }
});

test('under-length review receives expansion guidance and a pause-aware correction budget', async () => {
  const short = script([scene(1, 'Tiny bubbles slowly rise inside this chamber.')]);
  short.scenes[0].tts.pause_after_ms = 100;
  let calls = 0;
  const result = await scriptValidationAgent({ generate: async ({ prompt }) => {
    calls++;
    assert.match(prompt, /Below min_words: expand/);
    if (calls === 1) return reply(short);
    assert.match(prompt, /144.8 WPM/);
    assert.match(prompt, /"min_words":8,"max_words":8/);
    const fixed = script([scene(1, 'Watch the tiny bubbles rise inside this chamber.')]);
    fixed.scenes[0].tts.pause_after_ms = 100;
    return reply(fixed);
  } }, { ...context, script: short });
  assert.equal(calls, 2);
  assert.equal(inspectScriptTiming(result).issues.length, 0);
});
