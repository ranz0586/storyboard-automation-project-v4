export const text = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export function displayValue(value) {
  if (Array.isArray(value)) return value.map(displayValue).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => key.replaceAll('_', ' ') + ': ' + displayValue(item)).join('\n');
  return text(value);
}
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
export function readStoryboard(fields = {}) {
  let output = {}, warning = '', legacySummary = '';
  try { output = parse(fields.storyboard_text) || {}; }
  catch {
    if (typeof fields.storyboard_text === 'string' && fields.storyboard_text.trim() && !/^[\[{`]/.test(fields.storyboard_text.trim()) && ['structure1_json', 'structure2_json', 'structure3_json'].some(key => fields[key])) legacySummary = fields.storyboard_text;
    warning = legacySummary ? '' : 'Saved storyboard JSON is invalid. Showing available structure fields; raw data is preserved.';
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    output = {}; warning = 'Saved storyboard is not an object. Showing available structure fields.';
  }
  const result = { ...output, master_assets: output.master_assets || {} };
  for (const key of ['structure1', 'structure2', 'structure3']) {
    if (Array.isArray(output[key])) continue;
    try { const rows = parse(fields[key + '_json']); result[key] = Array.isArray(rows) ? rows : []; }
    catch { result[key] = []; warning = 'Some saved structure data is invalid; raw data is preserved.'; }
  }
  if (![result.structure1, result.structure2, result.structure3].some(rows => rows?.length)) {
    result.structure3 = [1, 2, 3].filter(n => fields['panel' + n + '_prompt']).map(n => ({ panel: n, panel_prompt: fields['panel' + n + '_prompt'] }));
  }
  return { output: result, warning, legacySummary };
}
export const timeRange = item => Number.isFinite(item.start_seconds) && Number.isFinite(item.end_seconds)
  ? `${item.start_seconds}–${item.end_seconds} s` : text(item.timestamp || item.time_range);
export const escapeHtml = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fieldsHtml = (item, structure1 = false) => Object.entries(item || {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => `<dt>${escapeHtml(key === 'image_prompt' || key === 'first_frame_prompt' || (structure1 && key === 'panel_prompt' && !item.image_prompt && !item.first_frame_prompt) ? 'Prompt A / image' : key === 'video_prompt' ? 'Prompt B / animation' : key.replaceAll('_', ' '))}</dt><dd>${escapeHtml(displayValue(value))}</dd>`).join('');
export function printableStoryboard(title, fields, {production=false,auditStatus='Unaudited'} = {}) {
  const { output, warning, legacySummary } = readStoryboard(fields);
  const sections = ['structure1', 'structure2', 'structure3'].flatMap((key, kind) => (output[key] || []).map((item, index) => {
    const { keyframes, ...panel } = item || {};
    return `<section><h2>Structure ${kind + 1} / ${kind ? 'Panel' : 'Scene'} ${index + 1}</h2><dl>${fieldsHtml(panel, kind === 0)}</dl>${Array.isArray(keyframes) ? keyframes.map((frame, i) => frame && typeof frame === 'object' ? `<article><h3>Keyframe ${i + 1}</h3><dl>${fieldsHtml(frame)}</dl></article>` : `<p>Keyframe reference: ${escapeHtml(frame)}</p>`).join('') : ''}</section>`;
  })).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#16202d;max-width:74ch;margin:2rem auto;padding:0 1rem}h1,h2,h3{line-height:1.2}section{border-top:1px solid #ccd2db;margin-top:3rem;padding-top:1rem}dt{font-weight:700;margin-top:1rem;break-after:avoid}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}article{margin-top:2rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}@page{margin:16mm}@media print{body{margin:0;max-width:none}section{break-before:page;border:0}h2,h3{break-after:avoid}}</style><body><h1>${escapeHtml(title)}</h1><p><strong>${production ? 'Production export' : 'Draft export'}</strong> · ${escapeHtml(auditStatus)}</p><p>Production prompts and planned timings. Preview images are not attached. Use your browser's Print command to save paginated sheets.</p>${warning ? `<p>${escapeHtml(warning)}</p>` : ''}${legacySummary ? `<p>Legacy storyboard: the summary is stored as text. Showing the saved structure fields.</p><p>${escapeHtml(legacySummary)}</p>` : ''}${output.production_brief ? '<h2>Saved production brief</h2><dl>' + fieldsHtml(output.production_brief) + '</dl>' : ''}<h2>Master assets</h2><dl>${fieldsHtml(output.master_assets)}</dl><h2>Additional saved prompts</h2><dl>${fieldsHtml(Object.fromEntries(['character_sheet_prompt', 'location_sheet_prompt', 'thumbnail_prompt'].filter(key => fields[key]).map(key => [key, fields[key]])))}</dl>${sections || '<section><h2>Legacy saved data</h2><pre>' + escapeHtml(JSON.stringify(fields, null, 2)) + '</pre></section>'}</body></html>`;
}
export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
