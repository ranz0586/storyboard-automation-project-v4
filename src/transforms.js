// Transforms mirroring the workflow's Code nodes
// ("Flatten Concept" and "Flatten Script"). No mutation of inputs; the only
// side effect is a warning log when agent output looks partial (see below).
import { logger } from './utils/logger.js';

// The || ''/0 fallbacks mask missing agent output — data still saves, but a
// mostly-empty record means the agent drifted from the schema. Surface that
// instead of failing silently.
function warnIfMostlyEmpty(kind, label, fields, threshold) {
  const empty = Object.entries(fields).filter(([, v]) => v === '' || v === 0);
  if (empty.length > threshold) {
    logger.warn(
      `${kind} "${label}" has ${empty.length} empty fields — agent output likely partial`,
      empty.map(([k]) => k).join(', ')
    );
  }
}

// Flatten Concept -> Ideas table fields.
export function flattenConcept(concept, { form, projectKey }) {
  const c = concept || {};

  const fields = {
    title: c.title || '',
    topic: c.topic || '',
    emotional_angle: c.emotional_angle || '',

    hook_text: c.hook_style?.hook_text || '',
    psychological_trigger: c.hook_style?.psychological_trigger || '',
    curiosity_gap: c.hook_style?.curiosity_gap || '',
    viewer_question: c.hook_style?.viewer_question || '',
    scroll_stop_reason: c.hook_style?.scroll_stop_reason || '',

    anti_analogy_approach: c.differentiation_opportunities?.anti_analogy_approach || '',
    visual_execution_style: c.differentiation_opportunities?.visual_execution_style || '',
    underserved_angle: c.differentiation_opportunities?.underserved_angle || '',

    format_category: c.viral_positioning?.format_category || '',
    system_mechanic_explained: c.viral_positioning?.system_mechanic_explained || '',
    loop_trigger_concept: c.viral_positioning?.loop_trigger_concept || '',
    // Normalize "STRUCTURE 07: TRANSFORMATION" -> "TRANSFORMATION" (matches
    // n8n). Models also emit arrow separators ("STRUCTURE 07 -> X" / "→"),
    // so accept those alongside the colon.
    selected_structure: (c.viral_positioning?.selected_structure || '')
      .replace(/^STRUCTURE\s+\d+\s*(?::|->|→|—|–|-)?\s*/i, '')
      .trim()
      .toUpperCase(),
    structure_reason: c.viral_positioning?.structure_reason || '',
    reward_position: c.viral_positioning?.reward_position || '',
    story_arc: c.viral_positioning?.story_arc || '',

    rank: c.rank || 0,
    // Airtable column is a number; the agent emits { overall, ... } (or a bare number).
    content_score: typeof c.content_score === 'number'
      ? c.content_score
      : (Number(c.content_score?.overall) || 0),

    // These scores also exist under content_score / viral_positioning in the
    // verbatim IDEA prompt's example (no production/review objects there), so
    // fall back to those when the model omits the dedicated objects.
    visual_potential:
      c.production?.visual_potential_score ??
      c.viral_positioning?.visual_potential_score ??
      c.content_score?.visual_potential ??
      0,
    storyboard_ready: String(
      c.production?.storyboard_ready ?? c.viral_positioning?.storyboard_ready ?? ''
    ),

    shareability: c.review?.shareability ?? c.content_score?.shareability ?? 0,
    value_delivered: c.review?.value_delivered ?? c.content_score?.value_delivered ?? 0,
    series_potential: c.review?.series_potential ?? c.content_score?.series_potential ?? 0,
    strategy_notes: c.review?.strategy_notes || '',

    niche: form.NICHE || '',
    platform: form.PLATFORM || '',
    ...(projectKey ? { Projects: projectKey } : {}),
  };
  // ~24 mapped fields; more than 8 empty means the concept came back thin.
  warnIfMostlyEmpty('Concept', fields.title || `rank ${fields.rank}`, fields, 8);
  return fields;
}

// Inverse of flattenConcept: rebuild a concept object from a saved Ideas row
// so the Script Agent can process ideas whose script generation previously
// failed (recovery flow). Lossless enough for the script prompt — the agent
// consumes these exact fields.
export function unflattenIdea(ideaRecord) {
  const f = ideaRecord?.fields || {};
  return {
    rank: f.rank || 0,
    content_score: f.content_score || 0,
    title: f.title || '',
    topic: f.topic || '',
    emotional_angle: f.emotional_angle || '',
    hook_style: {
      hook_text: f.hook_text || '',
      psychological_trigger: f.psychological_trigger || '',
      curiosity_gap: f.curiosity_gap || '',
      viewer_question: f.viewer_question || '',
      scroll_stop_reason: f.scroll_stop_reason || '',
    },
    differentiation_opportunities: {
      anti_analogy_approach: f.anti_analogy_approach || '',
      visual_execution_style: f.visual_execution_style || '',
      underserved_angle: f.underserved_angle || '',
    },
    viral_positioning: {
      format_category: f.format_category || '',
      system_mechanic_explained: f.system_mechanic_explained || '',
      loop_trigger_concept: f.loop_trigger_concept || '',
      selected_structure: f.selected_structure || '',
      structure_reason: f.structure_reason || '',
      reward_position: f.reward_position || '',
      story_arc: f.story_arc || '',
    },
    production: {
      visual_potential_score: f.visual_potential || 0,
      storyboard_ready: f.storyboard_ready || '',
    },
    review: {
      shareability: f.shareability || 0,
      value_delivered: f.value_delivered || 0,
      series_potential: f.series_potential || 0,
      strategy_notes: f.strategy_notes || '',
    },
  };
}

// Flatten Script -> Scripts table fields. projectId links the row to its
// Project — the storyboard stage resolves the project through this link.
export function flattenScript(script, { form, projectKey, scriptId }) {
  const s = script || {};
  const v = s.video || {};
  const fields = {
    // An idea-backed deterministic ID takes precedence over the model's
    // generated ID so retries can safely find and update the same script.
    video_id: scriptId || v.video_id || '',
    title: v.title || '',
    topic: v.topic || '',
    platform: v.platform || '',
    status: 'Draft',
    emotional_angle: v.emotional_angle || '',
    hook_type: v.hook_type || '',
    hook: v.hook || '',
    rehook: v.rehook || '',
    ending_loop_line: v.ending_loop_line || '',
    soft_cta: v.soft_cta || '',
    estimated_duration_seconds: v.estimated_duration_seconds || 0,
    thumbnail_text: v.thumbnail?.text || '',
    thumbnail_prompt: v.thumbnail?.prompt || '',
    voiceover_script: v.voiceover?.full_script || '',
    voice_style: v.voiceover?.voice_style || '',
    seo_keywords: (v.metadata?.seo_keywords || []).join(', '),
    viral_triggers: JSON.stringify(v.metadata?.viral_triggers || []),
    scenes_json: JSON.stringify(s.scenes || []),
    niche: form.NICHE || '',
    platform_input: form.PLATFORM || '',
    target_audience: form['TARGET AUDIENCE'] || '',
    content_style: form['CONTENT STYLE'] || '',
    ...(projectKey ? { Projects: projectKey } : {}),
  };
  // ~22 mapped fields; more than 7 empty means the script came back thin.
  warnIfMostlyEmpty('Script', fields.title || fields.video_id, fields, 7);
  return fields;
}

// Flatten Storyboard -> "Storyboard" table fields
// Ports the workflow's "Format Json" Code node verbatim,
// with two deliberate additions: (1) storyboard_id for idempotent upserts
// (keyed on the script's video_id — one storyboard per script); (2) null
// guards on structure3[0/1/2] so a short structure3 array doesn't throw.
// Column names follow the current table mapping (panel1_prompt, duration).
export function flattenStoryboard(sbOutput, scriptRecord) {
  const sb = sbOutput || {};
  const ma = sb.master_assets || {};
  const s3 = Array.isArray(sb.structure3) ? sb.structure3 : [];
  const f = scriptRecord?.fields || {};

  const fields = {
    // Added (not in n8n): upsert key so reruns update rather than duplicate.
    storyboard_id: f.video_id || '',
    // Relationship — Airtable linked record field requires an array.
    script_id: scriptRecord?.id ? [scriptRecord.id] : [],

    storyboard_status: 'Generated',
    storyboard_text: JSON.stringify(sbOutput || {}),
    structure_type: 'Structure 3',

    character_sheet_prompt: ma.character_sheets ||  ma.character_sheet_prompt ||  ma.character_sheet_prompts || '',
    location_sheet_prompt: ma.location_sheets || ma.location_sheet_prompt || ma.location_sheet_prompts || '',
    thumbnail_prompt: sb.thumbnail_prompt || '',

    structure1_json: JSON.stringify(sb.structure1 || []),
    structure2_json: JSON.stringify(sb.structure2 || []),
    structure3_json: JSON.stringify(sb.structure3 || []),

    panel1_prompt: s3[0]?.panel_prompt || '',
    panel2_prompt: s3[1]?.panel_prompt || '',
    panel3_prompt: s3[2]?.panel_prompt || '',

    duration: f.estimated_duration_seconds || 0,
    aspect_ratio: '9:16',
  };

  // ~12 content-bearing fields (storyboard_id/script_id excluded — they come
  // from the script record, not the agent). More than 6 empty means thin output.
  const { storyboard_id: _id, script_id: _sid, ...warnFields } = fields;
  warnIfMostlyEmpty('Storyboard', fields.storyboard_id || f.title, warnFields, 6);
  return fields;
}
