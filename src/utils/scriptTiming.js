export const MIN_WPM = 150;
export const MAX_WPM = 180;

// Count spoken tokens, preserving contractions; hyphenated words are separate.
// The validation agent must expand numbers/abbreviations into spoken words.
export function spokenWords(text) {
  return String(text || '').normalize('NFKC').replace(/’/g, "'").toLowerCase()
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
}

export function inspectScriptTiming(script) {
  const issues = [];
  const scenes = script.scenes.map((scene, index) => {
    const label = `Scene ${scene.scene_number}`;
    if (scene.scene_number !== index + 1) issues.push(`${label}: scene numbers must be sequential starting at 1`);
    const duration = scene.duration_seconds;
    if (!Number.isFinite(duration) || duration <= 0) issues.push(`${label}: duration_seconds must be finite and positive`);
    const pauses = ['pause_before_ms', 'pause_after_ms'].map(key => {
      const value = scene.tts?.[key] ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        issues.push(`${label}: tts.${key} must be a nonnegative number`);
        return NaN;
      }
      return value;
    });
    const speakingSeconds = duration - pauses.reduce((a, b) => a + b, 0) / 1000;
    const words = spokenWords(scene.narration).length;
    if (/\p{N}/u.test(scene.narration)) issues.push(`${label}: spell spoken numbers out so word budgets reflect the actual voiceover`);
    if (/[<>\[\]]/.test(scene.narration)) issues.push(`${label}: narration must be plain spoken text; encode pauses in tts fields`);
    const minWords = Math.ceil(speakingSeconds * MIN_WPM / 60 - 1e-9);
    const maxWords = Math.floor(speakingSeconds * MAX_WPM / 60 + 1e-9);
    const wpm = speakingSeconds > 0 ? words * 60 / speakingSeconds : null;
    if (words && (!(speakingSeconds > 0) || !Number.isFinite(speakingSeconds))) issues.push(`${label}: pauses leave no usable narration time`);
    else if (words && (wpm < MIN_WPM - 1e-6 || wpm > MAX_WPM + 1e-6)) {
      issues.push(`${label}: ${words} words in ${speakingSeconds.toFixed(3)} speaking seconds = ${wpm.toFixed(1)} WPM; allowed ${MIN_WPM}–${MAX_WPM} WPM (${minWords}–${maxWords} words)`);
    }
    if (!words && (!Number.isFinite(speakingSeconds) || speakingSeconds < 0)) issues.push(`${label}: pauses exceed the scene duration`);
    for (const key of ['description', 'image_prompt', 'video_prompt']) {
      if (typeof scene.visual?.[key] !== 'string' || !scene.visual[key].trim()) issues.push(`${label}: visual.${key} is required for narration/visual review`);
    }
    return { scene_number: scene.scene_number, duration_seconds: duration, speaking_seconds: speakingSeconds,
      word_count: words, wpm, min_words: minWords, max_words: maxWords };
  });
  const duration = script.scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  if (!Number.isFinite(script.video.estimated_duration_seconds) || !Number.isFinite(duration) ||
      Math.abs(script.video.estimated_duration_seconds - duration) > 0.01) {
    issues.push(`Video duration must match the sum of scene durations (${duration} seconds)`);
  }
  const voiceover = spokenWords(script.video.voiceover?.full_script);
  const narration = spokenWords(script.scenes.map(scene => scene.narration).join(' '));
  if (voiceover.join(' ') !== narration.join(' ')) issues.push('Full voiceover must match all scene narration in scene order, with no missing or extra spoken words');
  return { min_wpm: MIN_WPM, max_wpm: MAX_WPM, scenes, issues };
}
