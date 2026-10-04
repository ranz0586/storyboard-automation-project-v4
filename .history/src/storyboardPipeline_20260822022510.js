import { logger } from './utils/logger.js';
import { flattenStoryboard } from './transforms.js';
import { storyboardAgent } from './agents/storyboard/index.js';
import { safeTelegram } from './utils/alerts.js';

// Orchestrates the Schedule-trigger branch of workflow Zl1MpttLGWdWFqRU:
//   Search Approved scripts -> per script: Get project -> Storyboard Agent
//   -> upsert "Stroyboard" row -> mark script "Story Generated"
//
// Lifecycle: Draft -> Approved (manual, in Airtable) -> this poller ->
// Story Generated. Scripts are processed ONE at a time (same memory-conscious
// pattern as the content pipeline).
export async function runStoryboardPipeline({ clients }) {
  const { gemini, airtable, telegram } = clients;

  logger.mem('storyboard:start');

  const approved = await airtable.searchScripts("{status} = 'Approved'");
  logger.info(`Storyboard poll: ${approved.length} approved script(s)`);

  const results = [];
  for (const [i, script] of approved.entries()) {
    const label = script.fields.video_id || script.id;
    try {
      // n8n "Get a record": the project supplies niche/platform/references.
      const projectId = script.fields.Projects?.[0];
      const projectRecord = projectId ? await airtable.getProject(projectId) : null;
      if (!projectRecord) {
        logger.warn(`Storyboard: script ${label} has no linked Project — continuing without references`);
      }

      const sb = await storyboardAgent(gemini, { scriptRecord: script, projectRecord });
      const saved = await airtable.upsertStoryboard(flattenStoryboard(sb, script));
      await airtable.updateScript(script.id, { status: 'Story Generated' });

      results.push({ scriptId: script.id, storyboardId: saved.id });
      logger.info(`Storyboard ${i + 1}/${approved.length} saved`, saved.id);
    } catch (err) {
      logger.error(`Storyboard for script ${label} failed`, err?.message);
      await safeTelegram('Storyboard error', () => telegram.errorAlert({
        workflowName: 'Video Script Generation (Node)',
        nodeName: `Storyboard #${i + 1}`,
        message: err?.message || String(err),
      }));
      // Script stays "Approved" so the next poll retries it.
    }
    logger.mem(`storyboard:after:${i + 1}`);
  }

  logger.mem('storyboard:end');
  return { polled: approved.length, generated: results.length, results };
}
