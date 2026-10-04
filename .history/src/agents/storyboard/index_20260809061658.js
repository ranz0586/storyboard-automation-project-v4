import { STORYBOARD_SYSTEM } from './system.js';
import { buildStoryboardPrompt } from './prompt.js';
import { StoryboardOutputSchema } from '../../schemas.js';

// Replicates the "Storyboard Agent" node (Schedule-trigger branch).
// Consumes an approved Script record plus its linked Project record and
// produces a production package.
export async function storyboardAgent(gemini, { scriptRecord, projectRecord }) {
  const raw = await gemini.generate({
    system: STORYBOARD_SYSTEM,
    prompt: buildStoryboardPrompt({ scriptRecord, projectRecord }),
    json: true,
  });
  return StoryboardOutputSchema.parse(raw);
}
