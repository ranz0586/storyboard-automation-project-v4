import { RESEARCH_SYSTEM } from './system.js';
import { buildResearchPrompt } from './prompt.js';

// Replicates the "Research Agent" node. youtubeData (optional) comes from the
// Trend Scout (Node-only addition) — null means "no real data, run as n8n did".
export async function researchAgent(gemini, form, youtubeData = null) {
  // Returns the raw research report object; downstream only needs it as context.
  return gemini.generate({
    system: RESEARCH_SYSTEM,
    prompt: buildResearchPrompt(form, youtubeData),
    json: true,
  });
}
