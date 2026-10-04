import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GeminiClient } from '../src/clients/gemini.js';
import { processIdeaScript } from '../src/scriptWorker.js';
import { inspectScriptTiming } from '../src/utils/scriptTiming.js';
import { unflattenIdea } from '../src/transforms.js';
import { SCRIPT_VALIDATION_SYSTEM } from '../src/agents/scriptValidation/system.js';

// Explicit live check: one concept, real Gemini, local persistence only.
// No server, scheduler, Airtable client or Telegram client is initialized.
const baseline = process.argv.includes('--resume') ? JSON.parse(fs.readFileSync('data/hardening-live-script.json', 'utf8')) : null;
const control = process.argv.includes('--control');
const file = control ? 'data/hardening-live-script-control.json' : baseline ? 'data/hardening-live-script-resume.json' : 'data/hardening-live-script.json';
const result = { startedAt: new Date().toISOString(), status: 'RUNNING', requests: [], writes: 0,
  mode: control ? 'Live validation of a compliant control script; generation mocked'
    : baseline ? 'Replay captured live generation/review and request one live correction' : 'Fresh live generation and validation' };
const save = () => fs.writeFileSync(file, JSON.stringify(result, null, 2));
fs.mkdirSync('data', { recursive: true });
save();
try {
  const availability = JSON.parse(fs.readFileSync('data/hardening-models.json', 'utf8'));
  if (availability.status !== 'AVAILABLE') throw new Error('Verify configured model availability first');
  const prior = JSON.parse(fs.readFileSync('data/live-local-result.json', 'utf8'));
  const idea = { ...prior.idea, id: `local_validation_${randomUUID()}` };
  const concept = control ? { title: 'Why ice floats', topic: 'Freezing spreads water molecules apart; less dense ice floats on liquid water',
    emotional_angle: 'Curiosity' } : unflattenIdea(idea);
  const form = { NICHE: control ? 'Everyday physics' : idea.fields.niche || 'Everyday science',
    PLATFORM: Array.isArray(idea.fields.platform) ? idea.fields.platform[0] : idea.fields.platform || 'YouTube',
    'TARGET AUDIENCE': 'Adults', 'CONTENT STYLE': 'Clear visual explanations' };
  const live = new GeminiClient({ modelFactory: ({ apiKey, name, system, json }) => {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: name,
      systemInstruction: system, generationConfig: { temperature: 0.4,
        ...(json ? { responseMimeType: 'application/json' } : {}) } });
    return { generateContent: async prompt => {
      const attempt = { model: name, stage: system === SCRIPT_VALIDATION_SYSTEM ? 'validation' : 'generation', startedAt: new Date().toISOString() };
      result.requests.push(attempt); save();
      try {
        const response = await model.generateContent(prompt);
        attempt.status = 200; attempt.usage = response.response.usageMetadata;
        if (system === SCRIPT_VALIDATION_SYSTEM) result.validationOutput = JSON.parse(response.response.text());
        else result.generationOutput = JSON.parse(response.response.text());
        return response;
      } catch (error) { attempt.status = error.status || 'ERROR'; throw error; }
      finally { attempt.completedAt = new Date().toISOString(); save(); }
    } };
  } });
  let replayedReview = false;
  const gemini = { generate: async args => {
    if (control && args.system !== SCRIPT_VALIDATION_SYSTEM) {
      const scenes = [
        ['Freezing spreads water molecules apart, making ice less dense.',
          'A magnified ice lattice shows water molecules spaced farther apart than in liquid water.'],
        ['That lower density lets ice float on liquid water.', 'An ice cube floats at the surface of a clear glass of water.'],
      ].map(([narration, description], index) => ({ scene_number: index + 1,
        duration_seconds: 3, narration, tts: { pause_before_ms: 0, pause_after_ms: 0 },
        visual: { description, image_prompt: description, video_prompt: description } }));
      return { scripts: [{ video: { video_id: 'local-compliant-control', title: 'Why ice floats',
        estimated_duration_seconds: 6, voiceover: { full_script: scenes.map(scene => scene.narration).join(' ') } }, scenes }] };
    }
    if (baseline && args.system !== SCRIPT_VALIDATION_SYSTEM) return structuredClone(baseline.generationOutput);
    if (baseline && !replayedReview) { replayedReview = true; return structuredClone(baseline.validationOutput); }
    return live.generate(args);
  } };
  let stored;
  const airtable = { findScriptByVideoId: async () => stored || null,
    upsertScript: async fields => { result.writes++; stored = { id: 'localScript', fields }; result.script = stored; save(); return stored; } };
  const input = { idea, concept, form, gemini, airtable, projectKey: 'local_validation_only' };
  const generated = await processIdeaScript(input);
  const replay = await processIdeaScript(input);
  const fields = generated.script.fields;
  result.timing = inspectScriptTiming({ video: { estimated_duration_seconds: fields.estimated_duration_seconds,
    voiceover: { full_script: fields.voiceover_script } }, scenes: JSON.parse(fields.scenes_json) });
  result.replayGenerated = replay.generated;
  result.rateLimitedRequests = result.requests.filter(request => request.status === 429).length;
  if (result.timing.issues.length || result.writes !== 1 || replay.generated) throw new Error('Live persistence/replay gate failed');
  result.status = 'PASSED';
} catch (error) {
  result.status = 'FAILED';
  // Retain validation diagnostics; provider failure details are represented by
  // request statuses rather than raw responses or credential-bearing URLs.
  result.error = error.message?.startsWith('Script validation failed:') ? error.message : 'Live validation did not complete; inspect request statuses';
  if (Array.isArray(error.issues)) result.validationIssues = error.issues.map(({ path, message, code }) => ({ path, message, code }));
  process.exitCode = 1;
}
result.completedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ status: result.status, requests: result.requests.map(({ model, status }) => ({ model, status })),
  writes: result.writes, replayGenerated: result.replayGenerated, timingIssues: result.timing?.issues, artifact: file }));
