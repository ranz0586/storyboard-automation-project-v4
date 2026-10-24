import { OPENING_FRAME_CONTRACT } from '../../creativeGuidance/index.js';
import { STRUCTURE_KEYS, selectedStructures, structureSelectionInstruction } from '../../../shared/storyboardStructures.js';
import { STORYBOARD_SYSTEM } from './system.js';
import { buildStoryboardPrompt } from './prompt.js';
import { StoryboardOutputSchema } from '../../schemas.js';

// Replicates the "Storyboard Agent" node (Schedule-trigger branch).
// Consumes an approved Script record plus its linked Project record and
// produces a production package.
export async function storyboardAgent(gemini, { scriptRecord, projectRecord, brief }) {
  const raw = await gemini.generate({
    system: STORYBOARD_SYSTEM + structureSelectionInstruction(brief) + OPENING_FRAME_CONTRACT,
    prompt: buildStoryboardPrompt({ scriptRecord, projectRecord, brief }),
    json: true,
  });
  const selected = selectedStructures(brief?.structures);
  const candidate = Array.isArray(brief?.structures) && raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => !STRUCTURE_KEYS.includes(key) || selected.includes(key))) : raw;
  const output = StoryboardOutputSchema.parse(candidate);
  if (Array.isArray(brief?.structures) && selected.some(key => !output[key]?.length)) throw new Error('Incomplete storyboard: every selected structure is required');
  return output;
} 
