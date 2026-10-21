// User prompt template — equivalent of the n8n Storyboard Agent node's "text" (prompt) field.
// Mirrors the n8n wiring: script fields come from the Scripts search, while
// niche/platform/character_references/style_references come from the linked
// Project record ("Get a record" node).
import { approvedScriptTimeline } from '../../utils/storyboardValidation.js';

export function buildStoryboardPrompt({ scriptRecord, projectRecord }) {
  const f = scriptRecord.fields || {};
  const p = projectRecord?.fields || {};
  return `Generate a production-ready storyboard package from the approved script below.
The script has already been approved.
Do NOT rewrite, shorten, or improve the script.
Preserve immediate-value or static openings. CTAs are optional; never add a CTA absent from the approved script.
Preserve the narration, story progression, emotional pacing, and selected viral structure.
Convert the script into visual production assets.
Use character references and style references if available below.

FIDELITY CONTRACT:
Every populated structure must independently cover all approved scenes exactly once in global scene order. Optional formats may be omitted; do not emit partial alternatives.
structure1: frame is the global scene number; timestamp is the scene start/end range; narration copies the approved narration exactly.
structure2: panels have sequential panel numbers, contiguous time_range values and ordered keyframes containing global scene-number references.
structure3: panels have sequential panel numbers and contiguous time_range values. Each detailed keyframe uses its global frame number, exact scene time_range, image_prompt, and caption_narration copied exactly from that scene.
If both timestamp and time_range are present, they must agree. Use the approved start/end seconds below, formatted as MM:SS or decimal seconds; do not round fractional boundaries to whole seconds.
Preserve every spoken word, including silence in intentionally silent scenes. Do not add narration, omit scenes, overlap panels, stretch durations or exceed the total duration.

APPROVED SCENE TIMELINE (seconds, authoritative data):
${JSON.stringify(approvedScriptTimeline(scriptRecord))}


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
