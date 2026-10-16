import { researchEvidence } from '../../utils/evidence.js';
import { RESEARCH_SYSTEM } from './system.js';
import { buildResearchPrompt } from './prompt.js';

// Replicates the "Research Agent" node. youtubeData (optional) comes from the
// Trend Scout — absent metadata leaves observations empty and analysis unverified.
export async function researchAgent(gemini, form, youtubeData = null) {
  // Keep model analysis separate from the canonical provider observations.
  const report = await gemini.generate({
    system: RESEARCH_SYSTEM,
    prompt: buildResearchPrompt(form, youtubeData),
    json: true,
  });
  // Only provider metadata is an observation; model-generated analysis is unverified.
  return { ...researchEvidence(youtubeData, form.PLATFORM), hypotheses: report, confidence: 'unverified' };
}
