import { selectedStructures } from '../../shared/storyboardStructures.js';
import { spokenWords } from './scriptTiming.js';
import { StoryboardOutputSchema } from '../schemas.js';

const text = value => typeof value === 'string' && value.trim().length > 0;

// Keep the original forgiving parser. A separate persistence gate prevents
// defaults from turning an empty response into a completed production package.
// Any supported structure can be used; provided frames/panels need actual
// image/panel and video prompts. References may supply the master assets.
export function assertUsableStoryboard(output, scriptRecord, { structures } = {}) {
  const storyboard = StoryboardOutputSchema.parse(output);
  if (Array.isArray(structures)) {
    const selected = selectedStructures(structures);
    if (selected.some(key => !storyboard[key]?.length)) fail('every selected structure is required');
    if (['structure1', 'structure2', 'structure3'].some(key => storyboard[key]?.length && !selected.includes(key))) fail('unselected structures must not be persisted');
  }
  let entries = 0;
  for (const name of ['structure1', 'structure2', 'structure3']) {
    for (const [index, item] of (storyboard[name] || []).entries()) {
      entries++;
      const visualPrompt = name === 'structure1' ? item.image_prompt : item.panel_prompt;
      if (!text(visualPrompt) || !text(item.video_prompt)) {
        throw new Error(`Unusable storyboard: ${name}[${index}] needs visual and video prompts`);
      }
    }
  }
  if (!entries) throw new Error('Unusable storyboard: no production frames or panels');
  if (scriptRecord) assertStoryboardFidelity(storyboard, scriptRecord);
  return storyboard;
}

export function isUsableStoryboardRecord(record, storyboardId, scriptRecord, options) {
  if (!record?.id || record.fields?.storyboard_id !== storyboardId) return false;
  try {
    const output = record.fields.storyboard_text;
    assertUsableStoryboard(typeof output === 'string' ? JSON.parse(output) : output, scriptRecord, options);
    return true;
  } catch {
    return false;
  }
}

const normalizedText = value => String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
const fail = message => { throw new Error('Storyboard fidelity: ' + message); };
const close = (a, b) => Math.abs(a - b) <= 0.01;

export function approvedScriptTimeline(scriptRecord) {
  const fields = scriptRecord?.fields || {};
  let scenes;
  try { scenes = typeof fields.scenes_json === 'string' ? JSON.parse(fields.scenes_json) : fields.scenes_json; }
  catch { fail('approved Script scenes_json is not valid JSON'); }
  if (!Array.isArray(scenes) || !scenes.length) fail('approved Script needs a non-empty scenes_json array');
  let start = 0;
  const timeline = scenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object') fail('approved Script scenes must be objects');
    const duration = ['number', 'string'].includes(typeof scene.duration_seconds) ? Number(scene.duration_seconds) : NaN;
    if (scene.scene_number !== index + 1 || !Number.isFinite(duration) || duration <= 0 || typeof scene.narration !== 'string')
      fail('approved Script needs ordered scene numbers, positive durations and narration strings');
    const entry = { scene_number: index + 1, start, end: start + duration, narration: scene.narration };
    start = entry.end;
    return entry;
  });
  const declared = Number(fields.estimated_duration_seconds);
  if (!Number.isFinite(declared) || !close(start, declared)) fail('approved Script duration disagrees with its scenes');
  if (typeof fields.voiceover_script !== 'string' || spokenWords(fields.voiceover_script).join(' ') !== spokenWords(timeline.map(scene => scene.narration).join(' ')).join(' '))
    fail('approved Script voiceover disagrees with its scene narration');
  return timeline;
}

function seconds(value) {
  if (/^\d+(?:\.\d+)?\s*(?:s|sec|seconds)?$/i.test(value)) return Number(value.replace(/\s*(?:s|sec|seconds)$/i, ''));
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+(?:\.\d+)?$/.test(part))) return NaN;
  if (parts.slice(1).some(part => Number(part) >= 60) || parts.slice(0, -1).some(part => !/^\d+$/.test(part))) return NaN;
  return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
}

function checkTimes(item, expectedStart, expectedEnd, label, pointAllowed = false) {
  const keys = ['timestamp', 'time_range'].filter(key => item[key] !== undefined);
  if (!keys.length) fail(label + ' needs a timestamp or time_range');
  for (const key of keys) {
    if (typeof item[key] !== 'string') fail(label + '.' + key + ' must be a time string');
    const parts = item[key].trim().replace(/[–—]/g, '-').split(/\s*(?:-|→|\bto\b)\s*/i);
    const start = seconds(parts[0]);
    const point = parts.length === 1 && pointAllowed && key === 'timestamp';
    const end = point ? expectedEnd : seconds(parts[1] || '');
    if ((!point && parts.length !== 2) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !close(start, expectedStart) || !close(end, expectedEnd))
      fail(label + '.' + key + ' must match ' + expectedStart + '–' + expectedEnd + ' seconds');
  }
  if (item.duration_seconds !== undefined && !close(Number(item.duration_seconds), expectedEnd - expectedStart)) fail(label + ' duration disagrees with its approved scene');
}

function sceneId(frame, label) {
  const values = typeof frame === 'object' && frame !== null
    ? ['scene_number', 'frame', 'scene'].filter(key => frame[key] !== undefined).map(key => frame[key]) : [frame];
  const ids = values.map(value => {
    const match = /^(?:(?:scene|frame)\s*)?(\d+)$/i.exec(String(value).trim());
    return match ? Number(match[1]) : NaN;
  });
  if (!ids.length || ids.some(id => !Number.isInteger(id) || id < 1 || id !== ids[0])) fail(label + ' needs one unambiguous global scene/frame number');
  return ids[0];
}

function checkNarration(frame, scene, label, required) {
  const keys = ['narration', 'caption_narration'].filter(key => frame[key] !== undefined);
  if (required && !keys.length) fail(label + ' needs the approved scene narration');
  for (const key of keys) if (typeof frame[key] !== 'string' || normalizedText(frame[key]) !== normalizedText(scene.narration))
    fail(label + '.' + key + ' changes approved narration');
}

function assertStoryboardFidelity(storyboard, scriptRecord) {
  const timeline = approvedScriptTimeline(scriptRecord);
  const total = timeline.at(-1).end;
  if (storyboard.estimated_duration_seconds !== undefined && !close(Number(storyboard.estimated_duration_seconds), total)) fail('storyboard total duration disagrees with approved Script');
  for (const name of ['structure1', 'structure2', 'structure3']) {
    const rows = storyboard[name] || [];
    if (!rows.length) continue;
    let next = 0;
    for (const [index, item] of rows.entries()) {
      const label = name + '[' + index + ']';
      const frames = name === 'structure1' ? [item] : item.keyframes;
      if (!Array.isArray(frames) || !frames.length) fail(label + ' needs non-empty keyframes');
      if (name !== 'structure1') {
        const ids = ['panel', 'panel_number'].filter(key => item[key] !== undefined).map(key => Number(item[key]));
        if (!ids.length || ids.some(id => id !== index + 1)) fail(label + ' panel numbers must be sequential and unambiguous');
      }
      const panelStart = timeline[next]?.start;
      const narrations = [];
      for (const [frameIndex, frame] of frames.entries()) {
        const frameLabel = name === 'structure1' ? label : label + '.keyframes[' + frameIndex + ']';
        const id = sceneId(frame, frameLabel);
        const scene = timeline[next];
        if (!scene || id !== scene.scene_number) fail(frameLabel + ' duplicates, omits or reorders an approved scene');
        const object = typeof frame === 'object' && frame !== null;
        if (name !== 'structure2' && !object) fail(frameLabel + ' needs a detailed frame');
        if (object) {
          if (name !== 'structure2' || frame.timestamp !== undefined || frame.time_range !== undefined) checkTimes(frame, scene.start, scene.end, frameLabel, true);
          checkNarration(frame, scene, frameLabel, name !== 'structure2');
          if (name === 'structure3' && !text(frame.image_prompt)) fail(frameLabel + ' needs an image prompt');
        }
        narrations.push(scene.narration);
        next++;
      }
      if (name !== 'structure1') {
        checkTimes(item, panelStart, timeline[next - 1].end, label);
        checkNarration(item, { narration: narrations.join(' ') }, label, false);
      }
    }
    if (next !== timeline.length) fail(name + ' does not cover every approved scene and the full ' + total + '-second duration');
  }
  return storyboard;
}
