import { config } from './config.js';
import { logger } from './utils/logger.js';
import { createApp } from './app.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { runStoryboardPipeline } from './storyboardPipeline.js';
import { WeeklyScheduler } from './schedules/weeklyScheduler.js';
import { StoryboardPoller } from './storyboardPoller.js';

const app = createApp();
logger.info(`Gemini models: primary=${config.gemini.modelPrimary}, fallback=${config.gemini.modelFallback}`);

const scheduler = new WeeklyScheduler({
  scheduleStore: app.locals.scheduleStore,
  scriptRunController: app.locals.scriptRunController,
  timeZone: config.scheduler.timeZone,
});
const checkSchedules = () => {
  try {
    scheduler.tick();
  } catch (err) {
    logger.error('Weekly scheduler failed', err?.message);
  }
};
checkSchedules();
setInterval(checkSchedules, Math.max(10_000, config.scheduler.pollMs));

app.listen(config.server.port, () => {
  logger.info(`Server listening on :${config.server.port}`);
});

// Optional in-process storyboard poll (n8n Schedule Trigger equivalent).
// Off unless STORYBOARD_POLL_MS is set; `npm run storyboard` + cron also works.
if (config.pipeline.storyboardPollMs > 0) {
  const poller = new StoryboardPoller({
    queue: app.locals.pipelineQueue,
    run: options => runStoryboardPipeline({ ...options, runStore: app.locals.runStore }),
    makeClients: () => ({ gemini: gemini(), airtable: airtable(), telegram: telegram() }),
    onError: (err) => logger.error('Storyboard poll failed', err?.message),
  });
  setInterval(() => {
    if (!poller.tick()) logger.warn('Storyboard poll deferred — pipeline queue is full or already pending');
  }, config.pipeline.storyboardPollMs);
  logger.info(`Storyboard poll every ${Math.round(config.pipeline.storyboardPollMs / 1000)}s`);
}
