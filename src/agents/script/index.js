import { SCRIPT_SYSTEM } from './system.js';
import { buildScriptPrompt } from './prompt.js';
import { ScriptOutputSchema, UsableScriptSchema } from '../../schemas.js';

// Replicates the "Script Agent" node, but generates ONE script per concept.
// The n8n version fed all 10 concepts in one call and held all scripts in
// memory at once — a key contributor to the >500MB OOM. Looping per concept
// keeps peak memory to a single script.
export async function scriptAgent(gemini, { concept, form }) {
  const raw = await gemini.generate({
    system: SCRIPT_SYSTEM,
    prompt: buildScriptPrompt({ concept, form }),
    json: true,
  });
  const parsed = ScriptOutputSchema.parse(normalizeScripts(raw));
  // A lenient structural parse can legitimately produce no item or a script
  // filled only by defaults. The persistence layer must never see either.
  return UsableScriptSchema.parse(parsed.scripts[0]);
}

// The model sometimes flattens the video metadata to the script object's top
// level instead of nesting it under "video" (and may skip the "scripts"
// wrapper for a single result). Rebuild the canonical shape before validating.
function normalizeScripts(raw) {
  const out = raw?.scripts ? raw : { scripts: [raw] };
  out.scripts = (out.scripts || []).map((s) => {
    if (!s || s.video || typeof s !== 'object') return s;
    const { scenes = [], ...video } = s;
    return { video, scenes };
  });
  return out;
}
