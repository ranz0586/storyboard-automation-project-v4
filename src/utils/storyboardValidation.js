import { StoryboardOutputSchema } from '../schemas.js';

const text = value => typeof value === 'string' && value.trim().length > 0;

// Keep the original forgiving parser. A separate persistence gate prevents
// defaults from turning an empty response into a completed production package.
// Any supported structure can be used; provided frames/panels need actual
// image/panel and video prompts. References may supply the master assets.
export function assertUsableStoryboard(output) {
  const storyboard = StoryboardOutputSchema.parse(output);
  let entries = 0;
  for (const name of ['structure1', 'structure2', 'structure3']) {
    for (const [index, item] of (storyboard[name] || []).entries()) {
      entries++;
      const visualPrompt = name === 'structure1' ? item.image_prompt : item.panel_prompt;
      if (!text(visualPrompt) || !text(item.video_prompt)) {
        throw new Error(`Unusable storyboard: ${name}[${index}] needs visual and video prompts`);
      }
    }
  }
  if (!entries) throw new Error('Unusable storyboard: no production frames or panels');
  return storyboard;
}

export function isUsableStoryboardRecord(record, storyboardId) {
  if (!record?.id || record.fields?.storyboard_id !== storyboardId) return false;
  try {
    const output = record.fields.storyboard_text;
    assertUsableStoryboard(typeof output === 'string' ? JSON.parse(output) : output);
    return true;
  } catch {
    return false;
  }
}
