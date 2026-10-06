export function buildScriptValidationPrompt({ script, concept, form, timing, feedback = [] }) {
  return `Validate and repair this single script for narration timing and scene visuals.

PROJECT CONTEXT:
${JSON.stringify(form)}

SOURCE CONCEPT:
${JSON.stringify(concept)}

SCRIPT TO REVIEW:
${JSON.stringify(script)}

DETERMINISTIC TIMING CHECK (word budgets account for before/after pauses):
${JSON.stringify(timing)}

PREVIOUS VALIDATION ISSUES TO RESOLVE:
${JSON.stringify(feedback)}

TIMING REPAIR DIRECTIONS:
Treat min_words and max_words in the deterministic check as mandatory bounds for each narrated scene.
Below min_words: expand or rephrase narration with useful clarity to meet the minimum; do not shorten it or invent facts.
Above max_words: shorten unnecessary words or split essential information into more scenes of the same chosen duration.
Recount every repaired scene using its final pauses. Resolve BOTH under-length and over-length issues before setting approved=true. Rebuild full_script from final narration in scene order.

Return the complete final script and an explicit visual-alignment review for every final scene. Narrated scenes must remain between 150 and 180 WPM. Do not output a verdict alone.`;
}
