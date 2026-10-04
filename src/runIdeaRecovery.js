import { logger } from './utils/logger.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { runIdeaRecovery } from './ideaRecoveryPipeline.js';
import { config } from './config.js';
import { RunStore } from './runs/runStore.js';

// One-shot recovery of Draft/blank ideas into scripts.
// Usage: npm run recover-ideas            (default limit 50)
//        npm run recover-ideas -- 5       (limit 5)
(async () => {
  const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 50;
  try {
    const result = await runIdeaRecovery({
      clients: { gemini: gemini(), airtable: airtable(), telegram: telegram() },
      limit,
      runStore: new RunStore({ filePath: config.scheduler.runStatePath }),
    });
    logger.info('Idea recovery complete', `${result.recovered}/${result.stuck} scripts generated`);
    process.exit(0);
  } catch (err) {
    logger.error('Idea recovery failed', err?.stack || err?.message);
    process.exit(1);
  }
})();
