// User prompt template — equivalent of the n8n Storyboard Agent node's "text" (prompt) field.
// Mirrors the n8n wiring: script fields come from the Scripts search, while
// niche/platform/character_references/style_references come from the linked
// Project record ("Get a record" node).
export function buildStoryboardPrompt({ scriptRecord, projectRecord }) {
  const f = scriptRecord.fields || {};
  const p = projectRecord?.fields || {};
  return `Generate a production-ready storyboard package from the approved script below.
The script has already been approved.
Do NOT rewrite, shorten, or improve the script.
Preserve the narration, story progression, emotional pacing, and selected viral structure.
Convert the script into visual production assets.
Use character references and style references if available below.


## Script Information

Title:
${f.title || ''}

Topic:
${f.topic || ''}

Niche:
${p.niche || f.niche || ''}

Platform:
${p.platform || f.platform || f.platform_input || ''}

Estimated Duration:
${f.estimated_duration_seconds || ''}

Emotional Angle:
${f.emotional_angle || ''}

Voice Style:
${f.voice_style || ''}

Narration Script:
${f.voiceover_script || ''}

Scenes JSON:
${f.scenes_json || '[]'}

Character References:
${JSON.stringify(p.character_references ?? null)}

Style References:
${JSON.stringify(p.style_references ?? null)}`;
}
