import { logger } from './utils/logger.js';
import { unflattenIdea } from './transforms.js';
import { processIdeaScript } from './scriptWorker.js';
import { safeTelegram } from './utils/alerts.js';
import { projectKey } from './utils/project.js';
import { startActivity, finishActivity } from './runs/activity.js';

// Recovery flow: ideas whose script generation previously failed sit in the
// Ideas table with "Idea Status" = Draft (or blank, for rows saved before the
// pipeline stamped a status). Pick them up, rebuild the concept, run the
// Script Agent, save the script, and flip the idea to "Script Generated" —
// the same per-item lifecycle as the content pipeline's concept loop.
const STUCK_FILTER = "OR({Idea Status} = 'Draft', {Idea Status} = BLANK())";

export async function runIdeaRecovery({ clients, limit = 50, projectKeyFilter, runStore }) {
  const { gemini, airtable, telegram } = clients;
  const filter = projectKeyFilter
    ? `AND(${STUCK_FILTER}, {Projects} = "${String(projectKeyFilter).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
    : STUCK_FILTER;

  logger.mem('recovery:start');

  const savedScripts = [];
  let stuckCount = 0;
  const processOne = async (idea) => {
    const i = stuckCount;
    stuckCount += 1;
    const label = idea.fields.title || idea.id;
    let activity;
    try {
      // Rebuild the form context from the linked Project (falling back to the
      // idea's own niche/platform for rows without a Project link).
      const projectRef = idea.fields.Projects;
      const project = Array.isArray(projectRef)
        ? (projectRef[0] ? await airtable.getProject(projectRef[0]) : null)
        : (projectRef ? await airtable.findProjectByKey(projectRef) : null);
      if (!project) logger.warn(`Recovery: idea "${label}" has no linked Project — using defaults`);
      activity = startActivity(runStore, { projectId: project?.id, type: 'RECOVERY' });
      const p = project?.fields || {};
      const platform = Array.isArray(idea.fields.platform)
        ? idea.fields.platform[0] : idea.fields.platform;
      const form = {
        NICHE: idea.fields.niche || p.niche || '',
        PLATFORM: platform || p.platform || '',
        'TARGET AUDIENCE': p.target_audience || '',
        'CONTENT STYLE': p.content_style || '',
        'Has Character Reference Sheet': p.has_character_reference || 'N',
        'Has Style Reference': p.has_style_reference || 'N',
      };

      const concept = unflattenIdea(idea);
      const result = await processIdeaScript({
        idea,
        concept,
        form,
        projectKey: project ? projectKey(project) : undefined,
        gemini,
        airtable,
      });
      if (result.generated) savedScripts.push(scriptSummary(result.script));

      await airtable.updateIdea(idea.id, { 'Idea Status': 'Script Generated' });
      finishActivity(runStore, activity, { ideaId: idea.id, scriptId: result.script.id, generated: result.generated });
      logger.info(
        `Recovery ${i + 1}: script ${result.generated ? 'saved' : 'already exists'} for "${label}"`,
        result.script.id
      );
    } catch (err) {
      finishActivity(runStore, activity, { ideaId: idea.id }, err);
      logger.error(`Recovery for idea "${label}" failed`, err?.message);
      await safeTelegram('Recovery error', () => telegram.errorAlert({
        workflowName: 'Video Script Generation (Node)',
        nodeName: `Idea recovery #${i + 1}`,
        message: err?.message || String(err),
      }));
      // Idea stays Draft/blank so the next recovery run retries it.
    }
    logger.mem(`recovery:after:${i + 1}`);
  };

  if (typeof airtable.forEachStuckIdea === 'function') {
    await airtable.forEachStuckIdea(filter, { limit }, processOne);
  } else {
    // Compatibility for custom clients and existing integrations.
    const stuck = await airtable.searchIdeas(filter, limit);
    for (const idea of stuck) await processOne(idea);
  }
  logger.info(`Idea recovery: processed ${stuckCount} idea(s) without a script (limit ${limit})`);

  if (savedScripts.length) {
    await safeTelegram('Recovery completed', () => telegram.scriptsGeneratedAlert(savedScripts));
  }

  logger.mem('recovery:end');
  return { stuck: stuckCount, recovered: savedScripts.length, scripts: savedScripts };
}

function scriptSummary(script) {
  return {
    id: script.id,
    createdTime: script.createdTime,
    fields: { title: script.fields?.title || '' },
  };
}
