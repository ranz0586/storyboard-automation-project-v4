import { logger } from './utils/logger.js';
import { trendScoutAgent } from './agents/trendScout/index.js';
import { researchAgent } from './agents/research/index.js';
import { ideaAgent } from './agents/idea/index.js';
import { flattenConcept } from './transforms.js';
import { projectKey } from './utils/project.js';

export function formFromProject(project) {
  const p = project?.fields || {};
  return {
    NICHE: p.niche || '',
    PLATFORM: p.platform || '',
    'TARGET AUDIENCE': p.target_audience || '',
    'CONTENT STYLE': p.content_style || '',
    'CHANNEL NAME (Optional)': p.channel_page_name || '',
    'CHANNEL DESCRIPTION (Optional)': p.description || '',
    'Has Character Reference Sheet': p.has_character_reference || 'N',
    'Has Style Reference': p.has_style_reference || 'N',
  };
}

export async function generateIdeasForProject({ project, count, gemini, airtable, onSaved }) {
  const form = formFromProject(project);
  let youtubeData = await trendScoutAgent(gemini, form);
  logger.mem('idea-run:after:trendScout');
  let research = await researchAgent(gemini, form, youtubeData);
  youtubeData = null;
  logger.mem('idea-run:after:research');
  const concepts = await ideaAgent(gemini, { research, count });
  research = null;
  logger.mem('idea-run:after:idea');

  let savedCount = 0;
  for (let index = 0; index < concepts.length; index += 1) {
    const concept = concepts[index];
    const idea = await airtable.upsertIdea({
      ...flattenConcept(concept, { form, projectKey: projectKey(project) }),
      'Idea Status': 'Draft',
    });
    savedCount += 1;
    await onSaved?.({ idea, concept, savedCount });
    concepts[index] = null;
    logger.mem(`idea-run:after:save:${savedCount}`);
  }
  return { requestedCount: count, savedCount };
}
