// User prompt template — equivalent of the n8n Idea Agent node's "text" (prompt) field.
import { IDEA_OUTPUT_JSON_SCHEMA } from './schema.json.js';

export function buildIdeaPrompt({ research, count = 10 }) {
  return `Using the research report provided:

${JSON.stringify(research)}

Generate production-ready content concepts.
- ${count} content concepts
- unique emotional angles
- hook styles
- differentiation opportunities
- viral positioning


Requirements:
Rank all concepts from highest to lowest Content Score.
Each concept must be unique.
Each concept must use the most suitable Viral Content Structure.
Maximize virality, retention, shareability, value delivered, and visual storytelling potential.
Ensure concepts are storyboard-ready for AI video generation.
Delay the reward according to the selected Viral Content Structure.
Avoid duplicate topics, hooks, emotional angles, and story arcs.
Return concepts sorted by Content Score (highest first).

The output will be consumed directly by the Script Agent, so every concept should contain a complete strategic blueprint for script generation.

Return ONLY valid JSON conforming exactly to this JSON Schema (this overrides any example
output format in your instructions — in particular, content_score is a single NUMBER and
every concept must include the "production" and "review" objects):

${IDEA_OUTPUT_JSON_SCHEMA}`;
}
