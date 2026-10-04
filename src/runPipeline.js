import { config } from './config.js';
import { logger } from './utils/logger.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { runContentPipeline } from './pipeline.js';

// Standalone runner — same as submitting the NicheForm once.
// Usage: node src/runPipeline.js   (edit the sample form below or wire argv)
const sampleForm = {
  NICHE: 'What If',
  PLATFORM: 'Facebook',
  'TARGET AUDIENCE': 'US',
  'CONTENT STYLE': 'Edutainment',
  'CHANNEL NAME (Optional)': '',
  'CHANNEL DESCRIPTION (Optional)': 'What If FIFA, grounded physics',
  'Has Character Reference Sheet': 'N',
  'Has Style Reference': 'N',
};

(async () => {
  try {
    const result = await runContentPipeline({
      form: sampleForm,
      clients: {
        gemini: gemini(),
        airtable: airtable(),
        telegram: telegram(),
        conceptCount: config.pipeline.conceptCount,
      },
    });
    logger.info('Pipeline complete', result.scriptCount + ' scripts');
    process.exit(0);
  } catch (err) {
    logger.error('Pipeline failed', err?.stack || err?.message);
    process.exit(1);
  }
})();
