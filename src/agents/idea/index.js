import { IDEA_SYSTEM } from './system.js';
import { buildIdeaPrompt } from './prompt.js';
import { IdeaOutputSchema } from '../../schemas.js';

// Replicates the "Idea Agent" node (with Structured Output Parser2).
export async function ideaAgent(gemini, { research, count = 10 }) {
  const raw = await gemini.generate({
    system: IDEA_SYSTEM,
    prompt: buildIdeaPrompt({ research, count }),
    json: true,
  });
  const parsed = IdeaOutputSchema.parse(raw);
  return parsed.concepts;
}
