import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptAgent } from '../src/agents/script/index.js';

const context = { concept: { title: 'Concept' }, form: { PLATFORM: 'YouTube' } };

const validScript = {
  video: {
    video_id: 'video-1',
    title: 'A usable script',
    estimated_duration_seconds: 30,
    voiceover: { full_script: 'Complete narration.', voice_style: 'Warm' },
  },
  scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'Opening.' }],
};

test('scriptAgent returns a normalized usable script', async () => {
  const gemini = { generate: async () => ({ scripts: [validScript] }) };
  const result = await scriptAgent(gemini, context);
  assert.equal(result.video.video_id, 'video-1');
  assert.equal(result.scenes.length, 1);
});

test('scriptAgent rejects an empty scripts array', async () => {
  const gemini = { generate: async () => ({ scripts: [] }) };
  await assert.rejects(scriptAgent(gemini, context));
});

test('scriptAgent rejects output populated only by lenient defaults', async () => {
  const gemini = { generate: async () => ({}) };
  await assert.rejects(scriptAgent(gemini, context), /video_id must be a non-empty string/);
});

test('scriptAgent rejects scripts without usable narration or scenes', async () => {
  const gemini = {
    generate: async () => ({
      scripts: [{
        video: { video_id: 'video-2', title: 'Incomplete', estimated_duration_seconds: 30 },
        scenes: [],
      }],
    }),
  };
  await assert.rejects(scriptAgent(gemini, context), /voiceover\.full_script|at least one scene/);
});
