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

Return the complete final script and an explicit visual-alignment review for every final scene. Narrated scenes must remain between 150 and 180 WPM. Do not output a verdict alone.`;
}
