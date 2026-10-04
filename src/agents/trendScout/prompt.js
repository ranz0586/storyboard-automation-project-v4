// User prompt builder for the Trend Scout query planner (Node-only addition).
export function buildTrendScoutPrompt(form) {
  return `Plan YouTube search queries for trend research on:

NICHE:
${form.NICHE || ''}

PLATFORM:
${form.PLATFORM || ''}

TARGET AUDIENCE:
${form['TARGET AUDIENCE'] || ''}

CONTENT STYLE:
${form['CONTENT STYLE'] || ''}

CHANNEL DESCRIPTION:
${form['CHANNEL DESCRIPTION (Optional)'] || ''}

Return ONLY the JSON array of 3-5 search query strings.`;
}
