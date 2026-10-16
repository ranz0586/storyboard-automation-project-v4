import { conceptEvidence } from '../../utils/evidence.js';
import { IDEA_SYSTEM } from './system.js';
import { buildIdeaPrompt } from './prompt.js';
import { IdeaOutputSchema } from '../../schemas.js';

// Replicates the "Idea Agent" node (with Structured Output Parser2).
export async function ideaAgent(gemini, { research, count = 10, recentContent = [] }) {
  const raw = await gemini.generate({
    system: IDEA_SYSTEM,
    prompt: buildIdeaPrompt({ research, count, recentContent }),
    json: true,
  });
  const parsed = IdeaOutputSchema.parse(raw);
  return parsed.concepts.slice(0, count).map(concept => ({ ...concept, evidence: conceptEvidence(concept.evidence, research) }));
}
