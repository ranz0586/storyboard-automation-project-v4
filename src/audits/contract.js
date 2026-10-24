import { createHash } from 'node:crypto';
import { z } from 'zod';
import { STRUCTURE_KEYS, selectedStructures } from '../../shared/storyboardStructures.js';
import { assertUsableStoryboard, approvedScriptTimeline } from '../utils/storyboardValidation.js';
const scriptSceneTimeline=fields=>approvedScriptTimeline({fields}).map(row=>({scene_number:row.scene_number,start_seconds:row.start,end_seconds:row.end,narration:row.narration}));
const assertSourceTimeline=scriptSceneTimeline;
const assertStoryboardCoverage=(output,fields,options)=>assertUsableStoryboard(output,{fields},options);
function normalizeSavedStoryboard(fields,sourceFields){
  const copy=structuredClone(fields);
  if(typeof copy.storyboard_text==='string'&&!copy.storyboard_text.trim())delete copy.storyboard_text;
  const {output,warning}=readStoryboard(copy);
  if(warning)throw Error(warning);
  const value=assertUsableStoryboard(output,{fields:sourceFields});
  const timeline=scriptSceneTimeline(sourceFields);
  const id=frame=>Number(String(typeof frame==='object'?(frame.scene_number??frame.frame??frame.scene):frame).replace(/^(scene|frame)\s*/i,''));
  const frame=item=>{const scene=timeline[id(item)-1];return {...item,scene_number:scene.scene_number,start_seconds:scene.start_seconds,end_seconds:scene.end_seconds};};
  value.structure1=(value.structure1||[]).map(frame);
  for(const key of ['structure2','structure3'])value[key]=(value[key]||[]).map(panel=>{
    const ids=panel.keyframes.map(id);
    return {...panel,start_seconds:timeline[ids[0]-1].start_seconds,end_seconds:timeline[ids.at(-1)-1].end_seconds,keyframes:key==='structure3'?panel.keyframes.map(frame):ids};
  });
  return value;
}

import { readStoryboard } from '../../client/src/storyboard.js';

export const AUDIT_VERSION = '1';
export const RUBRIC_VERSION = 'narrated-plan@2';
export const AUDIT_SCOPE = 'production-plan';
export const MAX_AUDIT_INPUT_BYTES = 180_000;
export const MAX_AUDIT_REPORT_BYTES = 60_000;
export const DIMENSION_WEIGHTS = Object.freeze({ continuity: 25, prompt_alignment: 25, hook: 15, progression: 15, payoff: 15, brand: 5, media: 0 });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
export const canonicalHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const failure = (message, code = 'AUDIT_INVALID_REPORT') => Object.assign(new Error(message), { code });
const contentFields = (fields, excluded = []) => Object.fromEntries(Object.entries(fields || {}).filter(([key]) =>
  !['status', 'createdTime', 'updatedAt', 'created_at', 'updated_at', ...excluded].includes(key) && !/password|token|secret|api.?key/i.test(key)));

export function buildAuditInput({ projectRecord, scriptRecord, storyboardRecord, brief }) {
  const fields = storyboardRecord?.fields || {};
  const { output: storyboard, warning, legacySummary } = readStoryboard(structuredClone(fields));
  let normalizationError;
  try { Object.assign(storyboard, normalizeSavedStoryboard(fields, scriptRecord?.fields || {})); }
  catch (error) { normalizationError = error.message; }
  for (const frame of storyboard.structure1 || []) frame.image_prompt ||= frame.first_frame_prompt || frame.panel_prompt;
  for (const key of ['character_sheet_prompt', 'location_sheet_prompt', 'thumbnail_prompt']) {
    if (fields[key] && !storyboard.master_assets[key]) storyboard.master_assets[key] = fields[key];
  }
  brief = brief ?? storyboard.production_brief ?? null;
  const scriptKeys = ['video_id', 'title', 'topic', 'platform', 'emotional_angle', 'hook_type', 'hook', 'rehook', 'ending_loop_line', 'soft_cta', 'estimated_duration_seconds', 'thumbnail_text', 'thumbnail_prompt', 'voiceover_script', 'voice_style', 'seo_keywords', 'viral_triggers', 'scenes_json', 'niche', 'platform_input', 'target_audience', 'content_style'];
  const script = contentFields(Object.fromEntries(scriptKeys.filter(key => scriptRecord?.fields?.[key] !== undefined).map(key => [key, scriptRecord.fields[key]])));
  script.approved = ['Approved', 'Story Generated'].includes(scriptRecord?.fields?.status);
  let timeline = [], sceneError;
  try { timeline = scriptSceneTimeline(script); script.scenes = typeof script.scenes_json === 'string' ? JSON.parse(script.scenes_json) : (script.scenes_json || []); script.scenes_json = JSON.stringify(canonical(script.scenes)); }
  catch (error) { sceneError = error.message; }
  const present = STRUCTURE_KEYS.filter(key => storyboard[key]?.length);
  const structure_types = selectedStructures(brief?.structures ?? (present.length ? present : 'all'));
  const deterministic_checks = [];
  const check = (id, fn) => { try { fn(); deterministic_checks.push({ id, passed: true, message: 'Passed' }); }
    catch (error) { deterministic_checks.push({ id, passed: false, message: error.message }); } };
  check('approved_script', () => { if (!script.approved) throw new Error('Source script is not approved'); });
  check('workflow', () => { if (brief?.workflow && brief.workflow !== 'narrated-video') throw new Error('Unsupported audit workflow'); });
  check('source_timeline', () => { if (sceneError) throw new Error(sceneError); assertSourceTimeline(script); });
  check('usable_prompts', () => assertUsableStoryboard(storyboard));
  check('scene_coverage', () => { if (normalizationError) throw new Error(normalizationError); assertStoryboardCoverage(storyboard, script, { structures: structure_types }); });
  const project = contentFields(Object.fromEntries(['project_id', 'niche', 'platform', 'target_audience', 'content_style', 'channel_page_name', 'description', 'character_references', 'style_references', 'has_character_reference', 'has_style_reference'].filter(key => projectRecord?.fields?.[key] !== undefined).map(key => [key, projectRecord.fields[key]])));
  return { audit_version: AUDIT_VERSION, rubric_version: RUBRIC_VERSION, evidence_scope: AUDIT_SCOPE,
    project_id: project.project_id || projectRecord?.id || '', storyboard_id: fields.storyboard_id || script.video_id || '',
    workflow_type: brief?.workflow || 'narrated-video', structure_types, project, script, storyboard, brief,
    brief_hash: canonicalHash(brief), package_hash: canonicalHash({ storyboard, script, project }), deterministic_checks,
    evidence_limits: ['Text production plan only; rendered images, video, audio and measured viewer retention were not observed.',
      ...(!brief ? ['Legacy package has no frozen production brief.'] : []), ...(warning ? [warning] : []),
      ...(legacySummary ? ['Legacy summary is not structured production evidence.'] : [])] };
}
export function assertAuditInputSize(input) {
  if (bytes(input) > MAX_AUDIT_INPUT_BYTES) throw failure('Storyboard audit input exceeds supported size; nothing was truncated', 'AUDIT_INPUT_TOO_LARGE');
}
const shortText = z.string().trim().min(1).max(3000);
const pointerSchema = z.string().min(1).max(500).refine(value => /^\/(storyboard|script|brief|project)(\/|$)/.test(value), 'Evidence pointer must reference input content');
const evidenceSchema = z.object({ pointer: pointerSchema, quote: shortText }).strict();
const dimensionSchema = z.object({ id: z.enum(Object.keys(DIMENSION_WEIGHTS)), score: z.number().min(0).max(10).nullable(),
  applicable: z.boolean().optional(), weight: z.number().optional(), rationale: shortText, rule_ids: z.array(z.enum(Object.keys(DIMENSION_WEIGHTS))).min(1).max(7),
  evidence: z.array(evidenceSchema).max(12) }).strict();
const issueSchema = z.object({ id: z.string().optional(), severity: z.enum(['blocking', 'editorial']),
  category: z.enum(['coverage', 'narration', 'timing', 'missing_prompt', 'reference', 'continuity', 'prompt_alignment', 'sound', 'hook', 'progression', 'payoff', 'brand']),
  scene_id: z.number().int().positive().nullable().default(null), panel_id: z.number().int().positive().nullable().default(null),
  frame_id: z.number().int().positive().nullable().default(null), pointer: pointerSchema,
  time_range: z.object({ start_seconds: z.number().nonnegative(), end_seconds: z.number().nonnegative() }).strict().nullable().default(null),
  evidence: shortText, related_evidence: z.array(evidenceSchema).max(4).default([]), explanation: shortText, suggested_fix: shortText, fix_owner: z.enum(['script', 'storyboard', 'operator']) }).strict();
const reportSchema = z.object({ audit_version: z.literal(AUDIT_VERSION), rubric_version: z.literal(RUBRIC_VERSION),
  evidence_scope: z.literal(AUDIT_SCOPE), package_hash: z.string(), brief_hash: z.string(), workflow_type: z.string(),
  structure_types: z.array(z.enum(STRUCTURE_KEYS)).min(1).max(3), dimensions: z.array(dimensionSchema).length(Object.keys(DIMENSION_WEIGHTS).length),
  issues: z.array(issueSchema).max(60), evidence_limits: z.array(shortText).max(20), prioritized_actions: z.array(shortText).max(3),
  verdict: z.enum(['PASS', 'NEEDS_REVIEW', 'BLOCKED']).optional(), human_review_required: z.boolean().optional(),
  deterministic_checks: z.unknown().optional(), score: z.number().nullable().optional() }).strict();
function resolvePointer(input, pointer) {
  let value = input;
  for (const token of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(token)) throw failure('Invalid JSON pointer escape');
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value == null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw failure('Evidence pointer does not exist: ' + pointer);
    value = value[key];
  }
  return value;
}
function validateEvidence(input, pointer, quote) {
  const value = resolvePointer(input, pointer);
  if (typeof value !== 'string' || !value.includes(quote)) throw failure('Evidence quote is not present at its input pointer');
}
function validateLocation(issue, input) {
  const parts = issue.pointer.split('/');
  let node = input, scene, panel, frame, timed;
  for (const token of parts.slice(1)) {
    node = node?.[token.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      if (Number.isInteger(node.scene_number)) scene = node.scene_number;
      if (Number.isInteger(node.panel)) panel = node.panel;
      if (Number.isInteger(node.panel_number)) panel = node.panel_number;
      if (Number.isFinite(node.start_seconds) && Number.isFinite(node.end_seconds)) timed = node;
    }
  }
  const structure = parts[2];
  if (parts[1] === 'storyboard' && ['structure2', 'structure3'].includes(structure) && /^\d+$/.test(parts[3] || '')) panel ??= Number(parts[3]) + 1;
  if (parts.includes('keyframes')) frame = Number(parts[parts.indexOf('keyframes') + 1]) + 1;
  else if (structure === 'structure1' && /^\d+$/.test(parts[3] || '')) frame = Number(parts[3]) + 1;
  for (const [key, expected] of [['scene_id', scene], ['panel_id', panel], ['frame_id', frame]]) {
    if (issue[key] != null && issue[key] !== expected) throw failure('Issue ' + key + ' does not match its evidence');
  }
  if (issue.time_range) {
    const { start_seconds: start, end_seconds: end } = issue.time_range;
    if (!timed || end < start || start < timed.start_seconds || end > timed.end_seconds) throw failure('Issue time range is unsupported by its evidence');
  }
}
export function acceptAuditReport(raw, input) {
  try {
    if (bytes(raw) > MAX_AUDIT_REPORT_BYTES) throw failure('Audit report exceeds supported size');
    const report = reportSchema.parse(raw);
    for (const key of ['package_hash', 'brief_hash', 'workflow_type', 'evidence_scope']) if (report[key] !== input[key]) throw failure('Audit report metadata mismatch: ' + key);
    if (JSON.stringify(report.structure_types) !== JSON.stringify(input.structure_types)) throw failure('Audit report structures mismatch');
    if (new Set(report.dimensions.map(row => row.id)).size !== Object.keys(DIMENSION_WEIGHTS).length) throw failure('Audit dimensions must be unique and complete');
    const brandAvailable = Boolean(input.brief?.identity?.channel || input.brief?.identity?.description || input.brief?.styleReferences || input.brief?.characterReferences);
    const dimensions = report.dimensions.map(row => {
      const applicable = row.id !== 'media' && (row.id !== 'brand' || brandAvailable);
      if (row.id === 'media' && row.evidence.length) throw failure('Actual media evidence is unavailable in a production-plan audit');
      if ((!applicable && row.score !== null) || (row.score !== null && !row.evidence.length)) throw failure('A scored dimension requires applicable source evidence');
      row.evidence.forEach(({ pointer, quote }) => validateEvidence(input, pointer, quote));
      return { ...row, applicable, weight: applicable ? DIMENSION_WEIGHTS[row.id] : 0 };
    });
    const weightSum = dimensions.reduce((sum, row) => sum + row.weight, 0);
    dimensions.forEach(row => { row.weight = row.weight / weightSum; });
    const issues = report.issues.map(issue => {
      validateEvidence(input, issue.pointer, issue.evidence); validateLocation(issue, input);
      issue.related_evidence.forEach(({ pointer, quote }) => validateEvidence(input, pointer, quote));
      return { ...issue, id: 'issue_' + canonicalHash({ pointer: issue.pointer, evidence: issue.evidence, category: issue.category, severity: issue.severity, related_evidence: issue.related_evidence }).slice(0, 20) };
    });
    if (new Set(issues.map(issue => issue.id)).size !== issues.length) throw failure('Audit issues must be distinct');
    const blocked = input.deterministic_checks.some(check => !check.passed) || issues.some(issue => issue.severity === 'blocking');
    const incomplete = dimensions.some(row => row.applicable && row.score === null);
    const human_review_required = report.human_review_required === true || blocked || incomplete || issues.length > 0 || dimensions.some(row => row.applicable && row.score < 5);
    const score = incomplete ? null : Number(dimensions.reduce((sum, row) => sum + (row.score ?? 0) * row.weight, 0).toFixed(2));
    return { ...report, dimensions, issues, deterministic_checks: structuredClone(input.deterministic_checks), score,
      verdict: blocked ? 'BLOCKED' : human_review_required ? 'NEEDS_REVIEW' : 'PASS', human_review_required,
      evidence_limits: [...new Set([...input.evidence_limits, ...report.evidence_limits])] };
  } catch (error) { if (error.code) throw error; throw failure('Invalid audit report: ' + error.message); }
}
