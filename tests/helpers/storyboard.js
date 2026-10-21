export function storyboardReply(scriptRecord) {
  const scenes = typeof scriptRecord.fields.scenes_json === 'string' ? JSON.parse(scriptRecord.fields.scenes_json) : scriptRecord.fields.scenes_json;
  let start = 0;
  const frames = scenes.map(scene => {
    const end = start + scene.duration_seconds, time = start + 's - ' + end + 's';
    start = end;
    return { frame: scene.scene_number, timestamp: time, narration: scene.narration,
      image_prompt: 'A cinematic science experiment panel.', video_prompt: 'Follow the approved scene.' };
  });
  const panel = { panel: 1, time_range: '0s - ' + start + 's', panel_prompt: 'A cinematic science experiment panel.', video_prompt: 'Follow the approved sequence.' };
  return { master_assets: {}, structure1: frames,
    structure2: [{ ...panel, keyframes: frames.map(frame => frame.frame) }],
    structure3: [{ ...panel, keyframes: frames.map(frame => ({ frame: frame.frame, time_range: frame.timestamp, caption_narration: frame.narration, image_prompt: frame.image_prompt })) }] };
}
