import { SCRIPT_VALIDATION_SYSTEM } from '../../src/agents/scriptValidation/system.js';

export function scriptFromValidationPrompt(prompt) {
  return JSON.parse(prompt.split('SCRIPT TO REVIEW:\n')[1].split('\n\nDETERMINISTIC TIMING CHECK')[0]);
}

// External-service fixture: simulate a validation agent repairing the sparse
// old generation fixtures. Real acceptance/rejection is tested separately.
export function validationReply(input) {
  const script = structuredClone(input);
  const words = 'This simple experiment reveals how water changes under pressure'.split(' ');
  for (const scene of script.scenes) {
    const seconds = scene.duration_seconds - ((scene.tts?.pause_before_ms || 0) + (scene.tts?.pause_after_ms || 0)) / 1000;
    const count = Math.floor(seconds * 3);
    scene.narration = Array.from({ length: count }, (_, i) => words[i % words.length]).join(' ') + '.';
    scene.visual = { ...scene.visual, description: 'An experiment shows water changing under pressure.',
      image_prompt: 'Water in a transparent pressure chamber.', video_prompt: 'Water changes under pressure in the transparent chamber.' };
  }
  script.video.estimated_duration_seconds = script.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  script.video.voiceover.full_script = script.scenes.map(scene => scene.narration).join(' ');
  return { approved: true, script, issues: [], scene_reviews: script.scenes.map(scene => ({
    scene_number: scene.scene_number, visuals_match_narration: true, single_visual_moment: true,
    reason: 'The experiment visual illustrates the narration about water under pressure.',
  })) };
}

export const withScriptValidation = generate => ({ generate: async args => args.system === SCRIPT_VALIDATION_SYSTEM
  ? validationReply(scriptFromValidationPrompt(args.prompt)) : generate(args) });
