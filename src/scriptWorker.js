import { scriptAgent } from './agents/script/index.js';
import { scriptValidationAgent } from './agents/scriptValidation/index.js';
import { flattenScript } from './transforms.js';
import { UsableScriptSchema } from './schemas.js';
import { config } from './config.js';
import { withFileLock } from './utils/fileLock.js';
import { logger } from './utils/logger.js';

const inFlight = new Map();

// Airtable record IDs are stable for an idea and fit the existing Scripts
// table's video_id field. This avoids adding a new schema field solely for an
// idempotency key.
export function scriptIdForIdea(idea) {
  if (!idea?.id) throw new Error('Cannot generate a script without an idea record ID');
  return `idea_${idea.id}`;
}

export function isUsableScriptRecord(record) {
  const f = record?.fields;
  if (!f) return false;
  try {
    const scenes = typeof f.scenes_json === 'string' ? JSON.parse(f.scenes_json) : f.scenes_json;
    return UsableScriptSchema.safeParse({
      video: {
        video_id: f.video_id,
        title: f.title,
        estimated_duration_seconds: Number(f.estimated_duration_seconds),
        voiceover: { full_script: f.voiceover_script },
      },
      scenes,
    }).success;
  } catch {
    return false;
  }
}

// The one authoritative per-idea generation path. Normal runs, recovery,
// manual runs, and scheduled runs all converge here and remain sequential in
// their respective controllers.
export async function processIdeaScript({ idea, concept, form, projectKey, gemini, airtable, withLock = withFileLock }) {
  const scriptId = scriptIdForIdea(idea);
  while (inFlight.has(scriptId)) await inFlight.get(scriptId);
  const execution = withLock(scriptId, () => processUnlocked({
    scriptId,
    idea,
    concept,
    form,
    projectKey,
    gemini,
    airtable,
  }), { directory: config.locks.scriptDir });
  const completion = execution.then(() => undefined, () => undefined);
  inFlight.set(scriptId, completion);
  try {
    return await execution;
  } finally {
    if (inFlight.get(scriptId) === completion) inFlight.delete(scriptId);
  }
}

async function processUnlocked({ scriptId, concept, form, projectKey, gemini, airtable }) {
  const existing = await airtable.findScriptByVideoId(scriptId);
  if (isUsableScriptRecord(existing)) {
    return { script: existing, generated: false, updated: false };
  }

  let script = await scriptAgent(gemini, { concept, form });
  logger.mem(`script:${scriptId}:generated`);
  script = await scriptValidationAgent(gemini, { script, concept, form });
  logger.mem(`script:${scriptId}:validated`);
  const saved = await airtable.upsertScript(
    flattenScript(script, { form, projectKey, scriptId })
  );
  return { script: saved, generated: true, updated: Boolean(saved.updated) };
}
