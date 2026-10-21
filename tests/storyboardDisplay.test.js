import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoryboard, printableStoryboard, timeRange } from '../client/src/storyboard.js';

test('legacy summaries, scalar panel fields and malformed structures remain readable without changing saved data', () => {
  const fields = { storyboard_text: 'Original legacy summary', structure1_json: JSON.stringify([{ frame: 1, panel_prompt: 'Original image', video_prompt: 'Original motion' }]), unknown: 'Keep this' };
  const original = structuredClone(fields), result = readStoryboard(fields);
  assert.equal(result.legacySummary, fields.storyboard_text);
  assert.equal(result.output.structure1[0].panel_prompt, 'Original image');
  assert.equal(result.warning, '');
  assert.deepEqual(fields, original);
  assert.match(printableStoryboard('Legacy', fields), /Prompt A \/ image/);
  assert.equal(readStoryboard({ storyboard_text: '{broken', structure3_json: 'broken' }).warning.length > 0, true);
  assert.equal(readStoryboard({ panel1_prompt: 'Saved panel' }).output.structure3[0].panel_prompt, 'Saved panel');
  assert.equal(readStoryboard({ storyboard_text: '[]' }).warning.length > 0, true);
});

test('printable draft export retains all panels, references and complete escaped prompts without executable source content', () => {
  const attack = '<script>alert("unsafe")</script>';
  const longPrompt = 'Long image prompt '.repeat(600) + 'FULL_PROMPT_END';
  const output = { master_assets: { character: attack }, structure1: [{ frame: 1, narration: attack, image_prompt: longPrompt, video_prompt: 'Frame animation' }],
    structure2: [{ panel: 1, keyframes: [1], panel_prompt: 'Reference panel', video_prompt: 'Panel motion' }],
    structure3: Array.from({ length: 4 }, (_, index) => ({ panel: index + 1, panel_prompt: 'Panel ' + (index + 1), video_prompt: 'Motion ' + (index + 1), keyframes: [{ caption_narration: attack, image_prompt: longPrompt }] })) };
  const html = printableStoryboard(attack, { storyboard_text: JSON.stringify(output), thumbnail_prompt: attack });
  assert.match(html, /Draft export/);
  assert.doesNotMatch(html, /Production export|<script\b|javascript:/i);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes(longPrompt));
  assert.ok(html.includes('Structure 3 / Panel 4'));
  assert.ok(html.includes('Keyframe reference: 1'));
  assert.match(html, /break-before:page/);
});

test('display preserves both numeric and legacy clock timestamps', () => {
  assert.equal(timeRange({ start_seconds: 2.5, end_seconds: 6.5 }), '2.5–6.5 s');
  assert.equal(timeRange({ timestamp: '00:03 - 00:06' }), '00:03 - 00:06');
  assert.equal(timeRange({ time_range: '00:00 - 00:24' }), '00:00 - 00:24');
});
