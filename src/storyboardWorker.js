import { config } from './config.js';
import { storyboardAgent } from './agents/storyboard/index.js';
import { flattenStoryboard } from './transforms.js';
import { logger } from './utils/logger.js';
import { withFileLock } from './utils/fileLock.js';
import { assertUsableStoryboard, isUsableStoryboardRecord } from './utils/storyboardValidation.js';

// Shared by server polls and operator runs. The lock covers fresh lifecycle
// reads, generation, persistence and completion, including retries after an
// ambiguous write or a failed Script status update.
export async function processScriptStoryboard({ scriptRecord, clients, onStart }) {
  const { airtable, gemini } = clients;
  const storyboardId = scriptRecord.fields.video_id;
  if (typeof storyboardId !== 'string' || !storyboardId.trim()) {
    throw new Error('Cannot generate storyboard without a script video_id');
  }
  return withFileLock(`storyboard:${storyboardId}`, async () => {
    const script = await airtable.getScript(scriptRecord.id);
    if (script.fields.video_id !== storyboardId) throw new Error('Script identity changed during storyboard processing');
    if (script.fields.status !== 'Approved') return { skipped: true, generated: false };

    const ref = script.fields.Projects;
    const project = Array.isArray(ref)
      ? (ref[0] ? await airtable.getProject(ref[0]) : null)
      : (ref ? await airtable.findProjectByKey(ref) : null);
    onStart?.({ scriptRecord: script, projectRecord: project });

    let saved = await airtable.findStoryboardById(storyboardId);
    let generated = false;
    if (!isUsableStoryboardRecord(saved, storyboardId)) {
      if (!project) logger.warn(`Storyboard: script ${storyboardId} has no linked Project — continuing without references`);
      const output = assertUsableStoryboard(await storyboardAgent(gemini, {
        scriptRecord: script, projectRecord: project,
      }));
      saved = await airtable.upsertStoryboard(flattenStoryboard(output, script));
      generated = true;
    }
    await airtable.updateScript(script.id, { status: 'Story Generated' });
    return { scriptId: script.id, storyboardId: saved.id, generated, skipped: false };
  }, { directory: config.locks.scriptDir });
}
