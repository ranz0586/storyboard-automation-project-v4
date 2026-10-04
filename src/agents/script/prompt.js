// User prompt template — equivalent of the n8n Script Agent node's "text" (prompt) field.
// Divergence from n8n: the original fed ALL concepts in one call; this builds the
// prompt for ONE concept (per-concept loop = the OOM fix). See CLAUDE.md.
export function buildScriptPrompt({ concept, form }) {
  return `Create a highly optimized ${form.PLATFORM || ''} short-form video script for the single concept below.

CRITICAL INSTRUCTION:
Do not use a generic tone. Read the specific "emotional_angle" provided in the concept JSON below and use it as the driving emotional engine for this script. Use the concept's "selected_structure" for the scene-by-scene breakdown.

CONCEPT TO PROCESS:
${JSON.stringify(concept)}

Generate:
Generate a complete JSON object matching the requested Airtable schema, including:
- Full video metadata, title, and topic
- Complete VoiceOver script
- A detailed array of Scenes (breaking the script down shot-by-shot)
- For every scene, provide highly descriptive visual prompts, camera motion, text-on-screen, and precise TTS pacing details.
- If Character References flag is "Y" assume they are provided, scripts must use them for characters and scripts consistency
- If style reference flag is "Y" assume they are provided, scripts must use them to create style proficiency on the prompts

Character References: ${form['Has Character Reference Sheet'] || 'N'}

Style References: ${form['Has Style Reference'] || 'N'}

Return ONLY valid JSON of the form { "scripts": [ <one script object> ] } where the script object
has EXACTLY this top-level structure (this mirrors the required Airtable schema):

{
  "video": {
    "video_id": "",
    "title": "",
    "topic": "",
    "platform": "",
    "status": "Draft",
    "emotional_angle": "",
    "hook_type": "",
    "hook": "",
    "rehook": "",
    "ending_loop_line": "",
    "soft_cta": "",
    "estimated_duration_seconds": 0,
    "thumbnail": { "text": "", "prompt": "" },
    "voiceover": { "full_script": "", "voice_style": "" },
    "metadata": { "seo_keywords": [], "viral_triggers": [] }
  },
  "scenes": [ <scene objects exactly as specified in the SCENE JSON section> ]
}`;
}
