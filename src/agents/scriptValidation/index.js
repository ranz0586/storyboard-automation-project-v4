import { z } from 'zod';
import { EditorialReviewSchema, SceneReviewSchema, inspectEditorialReview, editorialResponseProperties } from '../../utils/editorialReview.js';
import { SCRIPT_VALIDATION_SYSTEM } from './system.js';
import { buildScriptValidationPrompt } from './prompt.js';
import { UsableScriptSchema } from '../../schemas.js';
import { inspectScriptTiming, spokenWords } from '../../utils/scriptTiming.js';

const ValidationOutputSchema = z.object({
  approved: z.boolean(),
  script: UsableScriptSchema,
  scene_reviews: z.array(SceneReviewSchema),
  editorial_review: EditorialReviewSchema,
  issues: z.array(z.string()).default([]),
});

function normalizeReview(raw) {
  // Live fallback output sometimes nests the review beside scenes instead
  // of beside script. Preserve explicit verdicts and validate every review;
  // never manufacture an approval or infer a missing semantic review.
  if (!raw || typeof raw !== 'object') return raw;
  return { ...raw, editorial_review: raw.editorial_review ?? raw.script?.editorial_review, scene_reviews: raw.scene_reviews ?? raw.script?.scene_reviews,
    issues: raw.issues ?? raw.script?.issues };
}

function pacingCorrection(timing, recentContent) {
  const fixes = timing.scenes.filter(scene => scene.word_count &&
    (scene.word_count < scene.min_words || scene.word_count > scene.max_words) && scene.min_words <= scene.max_words)
    .map(scene => ({ ...scene, target: Math.ceil((scene.min_words + scene.max_words) / 2) }));
  if (!fixes.length) return null;
  const properties = Object.fromEntries(fixes.map(scene => ['scene_' + scene.scene_number, {
    type: 'object', properties: {
      words: { type: 'array', minItems: scene.target, maxItems: scene.target, items: { type: 'string' } },
      visual: { type: 'object', properties: { description: { type: 'string' }, image_prompt: { type: 'string' }, video_prompt: { type: 'string' } }, required: ['description', 'image_prompt', 'video_prompt'] },
      visuals_match_narration: { type: 'boolean' }, single_visual_moment: { type: 'boolean' }, reason: { type: 'string' },
    }, required: ['words', 'visual', 'visuals_match_narration', 'single_visual_moment', 'reason'],
  }]));
  return { fixes, responseSchema: { type: 'object', properties: {
    ...editorialResponseProperties(recentContent), approved: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } },
    repairs: { type: 'object', properties, required: Object.keys(properties) },
  }, required: ['approved', 'issues', 'repairs', 'scene_reviews', 'editorial_review'] } };
}

function applyPacingCorrection(raw, candidate, correction) {
  // Custom clients can still return the complete review; every gate below applies.
  if (raw?.script) return raw;
  const script = structuredClone(candidate);
  for (const fix of correction.fixes) {
    const repair = raw?.repairs?.['scene_' + fix.scene_number];
    if (!Array.isArray(repair?.words) || repair.words.length !== fix.target ||
        repair.words.some(word => typeof word !== 'string' || /\s/.test(word.trim()) || spokenWords(word).length !== 1)) {
      throw new Error('Scene ' + fix.scene_number + ': correction requires exactly ' + fix.target + ' single spoken words');
    }
    if (['description', 'image_prompt', 'video_prompt'].some(key =>
      typeof repair.visual?.[key] !== 'string' || !repair.visual[key].trim())) {
      throw new Error('Scene ' + fix.scene_number + ': correction requires complete repaired visuals');
    }
    if (repair.visuals_match_narration !== true || repair.single_visual_moment !== true) throw new Error('Scene ' + fix.scene_number + ': correction visuals must pass review');
    const scene = script.scenes.find(scene => scene.scene_number === fix.scene_number);
    scene.narration = repair.words.map(word => word.trim()).join(' ');
    scene.visual = { ...scene.visual, ...repair.visual };

  }
  script.video.voiceover.full_script = script.scenes.map(scene => scene.narration).join(' ');
  return { approved: raw.approved, issues: raw.issues, script, scene_reviews: raw.scene_reviews, editorial_review: raw.editorial_review };
}

export async function scriptValidationAgent(gemini, { script, concept, form, recentContent = [] }) {
  let candidate = script, feedback = [], correction = null;
  const originalDurations = new Map(script.scenes.map(scene => [scene.scene_number, scene.duration_seconds]));
  let sourceAssociations = script.scenes.map(scene => ({ scene_number: scene.scene_number, source_scene_number: scene.scene_number }));
  // One review/repair plus one correction opportunity; never an unbounded
  // Gemini loop. Failed validation propagates before any Airtable write.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Rejected rewrites cannot redefine the duration used for repair instructions.
    const repairScenes = candidate.scenes.map(scene => {
      const associations = sourceAssociations.filter(row => row.scene_number === scene.scene_number);
      return { ...scene, duration_seconds: associations.length === 1 ? originalDurations.get(associations[0].source_scene_number) : undefined };
    });
    const repairTiming = inspectScriptTiming({ ...candidate, scenes: repairScenes });
    repairTiming.scenes = repairTiming.scenes.filter(scene => Number.isFinite(scene.duration_seconds) && scene.duration_seconds > 0);
    const prompt = buildScriptValidationPrompt({ script: candidate, concept, form,
      timing: inspectScriptTiming(candidate), repairTiming, feedback, recentContent }) + '\nORIGINAL SOURCE SCENE DURATIONS (source_scene_number, seconds): ' + JSON.stringify([...originalDurations]) + '\nPRIOR SOURCE SCENE ASSOCIATIONS (retain for unchanged scenes): ' + JSON.stringify(sourceAssociations);
    let raw;
    try {
      raw = await gemini.generate({
        system: correction ? SCRIPT_VALIDATION_SYSTEM + '\nFor this final pacing correction, return approved, issues, repairs, fresh scene_reviews for ALL final scenes and a fresh editorial_review according to the compact response format in the prompt. Do not return a full script. Each words array holds exactly the required number of single spoken words. Repair visuals to match the new narration and explicitly review them.' : SCRIPT_VALIDATION_SYSTEM,
        prompt: correction ? prompt + '\nFINAL PACING CORRECTION: Replace only the listed failing narrations. Preserve facts and emotional intent. Put one spoken word in each required words-array slot; never put a phrase in one slot. Preserve scene duration, pauses and all untouched scenes. The caller rebuilds the complete voiceover. If faithful repair is impossible, set approved=false.\nRequired word counts: ' + JSON.stringify(correction.fixes.map(scene => ({ scene: 'scene_' + scene.scene_number, words: scene.target }))) + '\nCOMPACT RESPONSE FORMAT: ' + JSON.stringify(correction.responseSchema) : prompt,
        // Keep the nested repair contract in the prompt; provider schema compilation can reject it with HTTP 400.
        json: true,
      });
    } catch (error) {
      if (error.code !== 'GEMINI_INVALID_JSON' && !(error instanceof SyntaxError)) throw error;
      feedback = ['Provider returned invalid JSON' + (error.model ? ` (model: ${error.model}; finish reason: ${error.finishReason || 'UNKNOWN'})` : ''), 'Return one syntactically valid JSON response with the complete required review; no comments, ellipses, unquoted properties or trailing commas.'];
      continue; // Malformed output consumes this attempt; the two-call budget is unchanged.
    }

    if (correction) {
      try { raw = applyPacingCorrection(raw, candidate, correction); }
      catch (error) { feedback = [error.message]; continue; }
    }
    const parsed = ValidationOutputSchema.safeParse(normalizeReview(raw));
    if (!parsed.success) {
      feedback = parsed.error.issues.map(issue => `Output ${issue.path.join('.')}: ${issue.message}`);
      feedback.push('Return approved, script, scene_reviews, editorial_review and issues as root fields of the validation response');
      continue;
    }
    const result = parsed.data;
    candidate = result.script;
    const timing = inspectScriptTiming(candidate);
    feedback = [...timing.issues];
    if (!result.approved) feedback.push(...(result.issues.length ? result.issues : ['Validation agent did not approve the script']));
    else if (result.issues.length) feedback.push(...result.issues);
    if (candidate.video.video_id !== script.video.video_id) feedback.push('Validation must preserve the script video_id');
    const reviews = result.scene_reviews;
    sourceAssociations = reviews.map(({ scene_number, source_scene_number }) => ({ scene_number, source_scene_number }));
    const sourceIds = candidate.scenes.map(scene => reviews.find(review => review.scene_number === scene.scene_number)?.source_scene_number);
    if (candidate.scenes.some((scene,index) => !originalDurations.has(sourceIds[index]) || Math.abs(scene.duration_seconds-originalDurations.get(sourceIds[index])) > 0.01) ||
        sourceIds.some((id,index) => index > 0 && id < sourceIds[index-1]) || [...originalDurations.keys()].some(id => !sourceIds.includes(id))) {
      feedback.push('Preserve each original scene duration and source order; split scenes retain their source_scene_number and chosen duration');
    }
    if (reviews.length !== candidate.scenes.length || new Set(reviews.map(review => review.scene_number)).size !== reviews.length) {
      feedback.push('Every final scene needs exactly one visual-alignment review');
    }
    for (const scene of candidate.scenes) {
      const review = reviews.find(item => item.scene_number === scene.scene_number);
      if (!review?.visuals_match_narration || !review?.single_visual_moment) feedback.push(`Scene ${scene.scene_number}: visuals must support its narration and depict one visual moment`);
    }
    feedback.push(...inspectEditorialReview(candidate, reviews, result.editorial_review, concept, recentContent));
    if (!feedback.length) {
      // Persist the measured target pace alongside pauses in scenes_json;
      // downstream narration tooling can use it without guessing a speed.
      candidate.scenes.forEach((scene, index) => {
        scene.editorial_review = { ...reviews.find(row => row.scene_number === scene.scene_number), ...(index === 0 ? { summary: result.editorial_review, version: 'editorial@1' } : {}) };
        scene.tts = { ...scene.tts, speaking_rate_wpm: Number((timing.scenes[index].wpm || 0).toFixed(3)) };
      });
      return candidate;
    }
    // Only timing-only repairs use the narrow structured response. Semantic,
    // identity, duration and malformed-review failures still require full review.
    correction = result.approved && !result.issues.length && feedback.every(issue =>
      /^Scene \d+: \d+ words in /.test(issue) || issue.startsWith('Full voiceover must match'))
      ? pacingCorrection(timing, recentContent) : null;
  }
  throw Object.assign(new Error(`Script validation failed: ${feedback.join('; ')}`), { code: 'SCRIPT_VALIDATION_FAILED' });
}
