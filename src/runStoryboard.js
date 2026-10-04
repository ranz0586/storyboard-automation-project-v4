import { logger } from './utils/logger.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { runStoryboardPipeline } from './storyboardPipeline.js';
import { config } from './config.js';
import { RunStore } from './runs/runStore.js';

// One-shot storyboard poll (replaces the n8n Schedule Trigger — run this from
// cron/Task Scheduler, e.g. every 15 min like the workflow did).
// Usage: npm run storyboard
(async () => {
  try {
    const result = await runStoryboardPipeline({
      clients: { gemini: gemini(), airtable: airtable(), telegram: telegram() },
      runStore: new RunStore({ filePath: config.scheduler.runStatePath }),
      source: 'OPERATOR',
    });
    logger.info('Storyboard poll complete', `${result.generated}/${result.polled} generated`);
    process.exit(0);
  } catch (err) {
    logger.error('Storyboard poll failed', err?.stack || err?.message);
    process.exit(1);
  }
})();
