export const STRUCTURE_OPTIONS = Object.freeze([
  { key: 'structure1', label: 'Structure 1', title: 'Individual clips', description: 'An image and animation prompt for each scene.' },
  { key: 'structure2', label: 'Structure 2', title: 'Video panels', description: 'Panel descriptions and animation prompts, with scene references.' },
  { key: 'structure3', label: 'Structure 3', title: 'Keyframe panels', description: 'Image prompts for keyframes, plus one animation prompt per panel.' },
]);
export const STRUCTURE_KEYS = Object.freeze(STRUCTURE_OPTIONS.map(option => option.key));
export function selectedStructures(value = 'all') {
  if (value === 'all') return [...STRUCTURE_KEYS];
  if (!Array.isArray(value) || !value.length || value.some(key => !STRUCTURE_KEYS.includes(key)) || new Set(value).size !== value.length) {
    throw new Error('Select at least one valid storyboard structure, without duplicates');
  }
  return STRUCTURE_KEYS.filter(key => value.includes(key));
}
export function structureSelectionInstruction(brief) {
  if (!Array.isArray(brief?.structures)) return '';
  const selected = selectedStructures(brief.structures);
  return '\n\nSTORYBOARD OUTPUT SELECTION (authoritative for this run):\nGenerate ONLY these structure keys: ' + selected.join(', ') +
    '. This replaces earlier instructions or example schemas requiring all three structures. Omit every unselected structure; do not generate hidden alternatives. Keep master_assets and other common production metadata.\n' +
    (selected.includes('structure2') ? 'For each Structure 2 panel, include keyframes as an ordered array of integer source scene_number references. Each source scene appears exactly once across panels. Panel time_range values match the first/last referenced scene boundaries. Use the approved narration as the soundtrack; do not rewrite it.\n' : '') +
    'Every selected structure must be nonempty and cover the complete approved script. Preserve the authoritative timing and narration. Return JSON only.';
}
