import { z } from 'zod';
import { SCRIPT_VALIDATION_SYSTEM } from './system.js';
import { buildScriptValidationPrompt } from './prompt.js';
import { UsableScriptSchema } from '../../schemas.js';
import { inspectScriptTiming } from '../../utils/scriptTiming.js';

const ValidationOutputSchema = z.object({
  approved: z.boolean(),
  script: UsableScriptSchema,
  scene_reviews: z.array(z.object({
    scene_number: z.number().int().positive(),
    visuals_match_narration: z.boolean(),
    single_visual_moment: z.boolean(),
    reason: z.string().trim().min(1),
  })),
  issues: z.array(z.string()).default([]),
});

function normalizeReview(raw) {
  // Live fallback output sometimes nests the review beside scenes instead
  // of beside script. Preserve explicit verdicts and validate every review;
  // never manufacture an approval or infer a missing semantic review.
  if (!raw || typeof raw !== 'object') return raw;
  return { ...raw, scene_reviews: raw.scene_reviews ?? raw.script?.scene_reviews,
    issues: raw.issues ?? raw.script?.issues };
}

export async function scriptValidationAgent(gemini, { script, concept, form }) {
  let candidate = script, feedback = [];
  const originalDuration = script.scenes[0]?.duration_seconds;
  // One review/repair plus one correction opportunity; never an unbounded
  // Gemini loop. Failed validation propagates before any Airtable write.
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = ValidationOutputSchema.safeParse(normalizeReview(await gemini.generate({
      system: SCRIPT_VALIDATION_SYSTEM,
      prompt: buildScriptValidationPrompt({ script: candidate, concept, form,
        timing: inspectScriptTiming(candidate), feedback }),
      json: true,
    })));
    if (!parsed.success) {
      feedback = parsed.error.issues.map(issue => `Output ${issue.path.join('.')}: ${issue.message}`);
      feedback.push('Return approved, script, scene_reviews and issues as root fields of the validation response');
      continue;
    }
    const result = parsed.data;
    candidate = result.script;
    const timing = inspectScriptTiming(candidate);
    feedback = [...timing.issues];
    if (!result.approved) feedback.push(...(result.issues.length ? result.issues : ['Validation agent did not approve the script']));
    else if (result.issues.length) feedback.push(...result.issues);
    if (candidate.video.video_id !== script.video.video_id) feedback.push('Validation must preserve the script video_id');
    if (originalDuration > 0 && candidate.scenes.some(scene => Math.abs(scene.duration_seconds - originalDuration) > 0.01)) {
      feedback.push('Preserve the chosen scene duration; shorten narration or add scenes instead of stretching scenes');
    }
    const reviews = result.scene_reviews;
    if (reviews.length !== candidate.scenes.length || new Set(reviews.map(review => review.scene_number)).size !== reviews.length) {
      feedback.push('Every final scene needs exactly one visual-alignment review');
    }
    for (const scene of candidate.scenes) {
      const review = reviews.find(item => item.scene_number === scene.scene_number);
      if (!review?.visuals_match_narration || !review?.single_visual_moment) feedback.push(`Scene ${scene.scene_number}: visuals must support its narration and depict one visual moment`);
    }
    if (!feedback.length) {
      // Persist the measured target pace alongside pauses in scenes_json;
      // downstream narration tooling can use it without guessing a speed.
      candidate.scenes.forEach((scene, index) => {
        scene.tts = { ...scene.tts, speaking_rate_wpm: Number((timing.scenes[index].wpm || 0).toFixed(3)) };
      });
      return candidate;
    }
  }
  throw new Error(`Script validation failed: ${feedback.join('; ')}`);
}
