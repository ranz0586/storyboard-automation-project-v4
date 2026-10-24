import { pendingAuditIntent } from './cloud/productionWork.js';
import { formFromProject } from './ideaGeneration.js';
import { config } from './config.js';
import { storyboardAgent } from './agents/storyboard/index.js';
import { flattenStoryboard } from './transforms.js';
import { logger } from './utils/logger.js';
import { withFileLock } from './utils/fileLock.js';
import { assertUsableStoryboard, isUsableStoryboardRecord, approvedScriptTimeline } from './utils/storyboardValidation.js';

// Shared by server polls and operator runs. The lock covers fresh lifecycle
// reads, generation, persistence and completion, including retries after an
// ambiguous write or a failed Script status update.
export async function processScriptStoryboard({ scriptRecord, clients, onStart, briefStore = clients.briefStore, withLock = withFileLock, auditStore = clients.auditStore }) {
  const { airtable, gemini } = clients;
  const storyboardId = scriptRecord.fields.video_id;
  if (typeof storyboardId !== 'string' || !storyboardId.trim()) {
    throw new Error('Cannot generate storyboard without a script video_id');
  }
  return withLock(`storyboard:${storyboardId}`, async () => {
    const script = await airtable.getScript(scriptRecord.id);
    if (script.fields.video_id !== storyboardId) throw new Error('Script identity changed during storyboard processing');
    if (script.fields.status !== 'Approved') return { skipped: true, generated: false };

    approvedScriptTimeline(script);
    const ref = script.fields.Projects;
    const project = Array.isArray(ref)
      ? (ref[0] ? await airtable.getProject(ref[0]) : null)
      : (ref ? await airtable.findProjectByKey(ref) : null);
    onStart?.({ scriptRecord: script, projectRecord: project });

    if(auditStore && !project)throw new Error('Storyboard audit requires a resolved owning project');
    const ownerKey = project?.fields?.project_id;
    let brief = ownerKey && briefStore ? await briefStore.get(ownerKey, storyboardId) : null;
    let saved = await airtable.findStoryboardById(storyboardId);
    let generated = false;
    const enrollment=auditStore?await auditStore.enrollment(project.id,script.id):null;
    if (!isUsableStoryboardRecord(saved, storyboardId, script, { structures: brief?.structures })) {
      if (!project) logger.warn(`Storyboard: script ${storyboardId} has no linked Project — continuing without references`);
      if (ownerKey && briefStore) brief = await briefStore.freeze(ownerKey, storyboardId, formFromProject(project), 'legacy-storyboard');
      if(auditStore && (enrollment || process.env.STORYBOARD_AUDIT_AUTO_ENABLED !== 'false'))await auditStore.enroll({projectId:project.id,projectKey:ownerKey,scriptId:script.id,videoId:storyboardId,source:'GENERATION',beginGeneration:true});
      const output = assertUsableStoryboard(await storyboardAgent(gemini, {
        scriptRecord: script, projectRecord: project, brief,
      }), script, { structures: brief?.structures });
      if (brief) output.production_brief = brief;
      saved = await airtable.upsertStoryboard(flattenStoryboard(output, script, project));
      generated = true;
    }
    if(auditStore && await auditStore.enrollment(project.id,script.id))await pendingAuditIntent({auditStore,projectRecord:project,scriptRecord:script,storyboardRecord:saved,briefStore});
    await airtable.updateScript(script.id, { status: 'Story Generated' });
    if(auditStore)await auditStore.completeGeneration(project.id,script.id);
    return { scriptId: script.id, storyboardId: saved.id, generated, skipped: false };
  }, { directory: config.locks.scriptDir });
}
