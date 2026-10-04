import { logger } from './utils/logger.js';
import { flattenConcept } from './transforms.js';
import { researchAgent } from './agents/research/index.js';
import { trendScoutAgent } from './agents/trendScout/index.js';
import { ideaAgent } from './agents/idea/index.js';
import { processIdeaScript } from './scriptWorker.js';
import { safeTelegram } from './utils/alerts.js';

// Orchestrates the NicheForm branch of workflow Zl1MpttLGWdWFqRU:
//   Save Project -> Trend Scout (yt-dlp, optional) -> Research -> Idea
//     -> (per concept) Save Idea -> Script -> Save Script
//   -> Telegram alert
//
// Memory-conscious: scripts are generated and persisted ONE concept at a time,
// so peak memory holds a single script rather than all N. This is the main
// divergence from the n8n version that OOM'd at ~500MB.
export async function runContentPipeline({ form, clients }) {
  const { gemini, airtable, telegram } = clients;
  const conceptCount = clients.conceptCount ?? 10;

  logger.mem('pipeline:start');

  // 1. Save to Project — upsert keyed on project_id so a rerun reuses the
  //    existing project instead of creating one per run. project_id is
  //    niche + "_" + platform with spaces stripped from the platform,
  //    e.g. "What If_Facebook".
  const project = await airtable.upsertProject({
    project_id: `${form.NICHE || ''}_${(form.PLATFORM || '').replace(/\s+/g, '')}`,
    niche: form.NICHE || '',
    platform: form.PLATFORM || '',
    target_audience: form['TARGET AUDIENCE'] || '',
    content_style: form['CONTENT STYLE'] || '',
    channel_page_name: form['CHANNEL NAME (Optional)'] || '',
    description: form['CHANNEL DESCRIPTION (Optional)'] || '',
    has_character_reference: form['Has Character Reference Sheet'] || 'N',
    has_style_reference: form['Has Style Reference'] || 'N',
  });
  logger.info(project.updated ? 'Project reused (updated)' : 'Project created', project.id);

  // 2a. Trend Scout (Node-only addition): plan YouTube queries, run yt-dlp
  //     for real search metadata. Null on any failure — research then runs
  //     exactly as the n8n original did.
  let youtubeData = await trendScoutAgent(gemini, form);
  logger.mem('after:trendScout');

  // 2b. Research Agent (grounded in real YouTube data when available)
  let research = await researchAgent(gemini, form, youtubeData);
  // Release the scouted metadata once research has consumed it.
  youtubeData = null;
  logger.mem('after:research');

  // 3. Idea Agent -> N concepts
  const concepts = await ideaAgent(gemini, { research, count: conceptCount });
  logger.info(`Idea Agent produced ${concepts.length} concepts`);
  // Release the (large) research report once concepts exist.
  research = null;
  logger.mem('after:idea');

  const savedScripts = [];

  // 4. Per-concept loop: save idea, generate script, save script.
  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i];

    try {
      const idea = await airtable.upsertIdea({
        ...flattenConcept(concept, { form, projectId: project.id }),
        // Explicit lifecycle start; flipped to "Script Generated" below (and
        // the recovery flow picks up Draft/blank rows if that never happens).
        'Idea Status': 'Draft',
      });

      const result = await processIdeaScript({
        idea,
        concept,
        form,
        projectId: project.id,
        gemini,
        airtable,
      });
      if (result.generated) savedScripts.push(result.script);

      // Mark the idea done only after its script actually persisted.
      await airtable.updateIdea(idea.id, { 'Idea Status': 'Script Generated' });

      logger.info(
        `Script ${i + 1}/${concepts.length} ${result.generated ? 'saved' : 'already exists'}`,
        result.script.id
      );
    } catch (err) {
      logger.error(`Concept ${i + 1} failed`, err?.message);
      await safeTelegram('Script error', () => telegram.errorAlert({
        workflowName: 'Video Script Generation (Node)',
        nodeName: `Script loop #${i + 1}`,
        message: err?.message || String(err),
      }));
      // Continue with remaining concepts (mirrors continueErrorOutput intent).
    }
    logger.mem(`after:script:${i + 1}`);
  }

  // 5. Telegram alert (dynamic, count-safe).
  if (savedScripts.length) {
    await safeTelegram('Scripts generated', () => telegram.scriptsGeneratedAlert(savedScripts));
  }

  logger.mem('pipeline:end');
  return { projectId: project.id, scriptCount: savedScripts.length, scripts: savedScripts };
}
