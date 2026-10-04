import { logger } from './utils/logger.js';
import { processScriptStoryboard } from './storyboardWorker.js';
import { safeTelegram } from './utils/alerts.js';
import { startActivity, finishActivity } from './runs/activity.js';

// Orchestrates the Schedule-trigger branch of workflow Zl1MpttLGWdWFqRU:
//   Search Approved scripts -> per script: Get project -> Storyboard Agent
//   -> upsert "Storyboard" row -> mark script "Story Generated"
//
// Lifecycle: Draft -> Approved (manual, in Airtable) -> this poller ->
// Story Generated. Scripts are processed ONE at a time (same memory-conscious
// pattern as the content pipeline).
export async function runStoryboardPipeline({ clients, projectKeyFilter, runStore, source = 'STORYBOARD_POLL' }) {
  const { airtable, telegram } = clients;

  logger.mem('storyboard:start');

  const statusFilter = "{status} = 'Approved'";
  const filter = projectKeyFilter
    ? `AND(${statusFilter}, {Projects} = "${String(projectKeyFilter).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
    : statusFilter;
  const approved = await airtable.searchScripts(filter);
  logger.info(`Storyboard poll: ${approved.length} approved script(s)`);

  const results = [];
  for (const [i, script] of approved.entries()) {
    const label = script.fields.video_id || script.id;
    let activity;
    try {
      const result = await processScriptStoryboard({ scriptRecord: script, clients,
        onStart: ({ projectRecord }) => { activity = startActivity(runStore, {
          projectId: projectRecord?.id, type: 'STORYBOARD', source,
        }); } });
      if (!result.skipped) {
        finishActivity(runStore, activity, { scriptId: script.id,
          storyboardId: result.storyboardId, generated: result.generated });
        results.push(result);
        logger.info(`Storyboard ${i + 1}/${approved.length} ${result.generated ? 'saved' : 'reused'}`, result.storyboardId);
      }
    } catch (err) {
      finishActivity(runStore, activity, { scriptId: script.id }, err);
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
