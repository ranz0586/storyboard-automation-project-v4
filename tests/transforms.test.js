import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenStoryboard } from '../src/transforms.js';

const scriptRecord = {
  id: 'recScript1',
  fields: {
    video_id: 'video-1',
    title: 'Test video',
    estimated_duration_seconds: 30,
  },
};

test('flattenStoryboard preserves canonical structure3 data and panel prompts', () => {
  const structure3 = [
    { panel: 1, panel_prompt: 'Wide establishing shot', keyframes: [{ scene: 1 }] },
    { panel: 2, panel_prompt: 'Close-up reaction', keyframes: [{ scene: 2 }] },
    { panel: 3, panel_prompt: 'Final reveal', keyframes: [{ scene: 3 }] },
  ];

  const fields = flattenStoryboard(
    {
      master_assets: { character_sheet_prompt: 'Consistent character' },
      structure1: [{ scene: 1 }],
      structure2: [{ frame: 1 }],
      structure3,
      thumbnail_prompt: 'Thumbnail',
    },
    scriptRecord
  );

  assert.deepEqual(JSON.parse(fields.structure3_json), structure3);
  assert.deepEqual(JSON.parse(fields.storyboard_text).structure3, structure3);
  assert.equal(fields.panel1_prompt, 'Wide establishing shot');
  assert.equal(fields.panel2_prompt, 'Close-up reaction');
  assert.equal(fields.panel3_prompt, 'Final reveal');
});

test('flattenStoryboard safely handles an omitted or short structure3 array', () => {
  const omitted = flattenStoryboard({ master_assets: {} }, scriptRecord);
  assert.equal(omitted.structure3_json, '[]');
  assert.equal(omitted.panel1_prompt, '');
  assert.equal(omitted.panel2_prompt, '');
  assert.equal(omitted.panel3_prompt, '');

  const short = flattenStoryboard(
    { master_assets: {}, structure3: [{ panel_prompt: 'Only panel' }] },
    scriptRecord
  );
  assert.equal(short.panel1_prompt, 'Only panel');
  assert.equal(short.panel2_prompt, '');
  assert.equal(short.panel3_prompt, '');
});
