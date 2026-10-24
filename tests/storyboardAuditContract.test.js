import { buildStoryboardAuditPrompt } from '../src/agents/storyboardAudit/prompt.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditInput, acceptAuditReport, canonicalHash, MAX_AUDIT_INPUT_BYTES } from '../src/audits/contract.js';
import { storyboardAuditAgent } from '../src/agents/storyboardAudit/index.js';
import { STORYBOARD_AUDIT_SYSTEM } from '../src/agents/storyboardAudit/system.js';
import { validAuditReport } from './helpers/storyboardAudit.js';
function fixture(structures = ['structure1']) {
  const frame = { scene_number: 1, start_seconds: 0, end_seconds: 3, narration: 'Mark the cardboard.', image_prompt: 'Unmarked cardboard on the table.', video_prompt: 'A hand draws a pencil mark on the cardboard.' };
  const output = { master_assets: {}, ...(structures.includes('structure1') ? { structure1: [frame] } : {}),
    ...(structures.includes('structure2') ? { structure2: [{ panel: 1, start_seconds: 0, end_seconds: 3, keyframes: [1], panel_prompt: 'Cardboard marking sequence.', video_prompt: frame.video_prompt }] } : {}),
    ...(structures.includes('structure3') ? { structure3: [{ panel: 1, start_seconds: 0, end_seconds: 3, panel_prompt: 'Cardboard marking sequence.', video_prompt: frame.video_prompt,
      keyframes: [{ ...frame, caption_narration: frame.narration }] }] } : {}) };
  return { projectRecord: { id: 'recP', fields: { project_id: 'project', channel_page_name: 'DIY', description: 'Useful projects', character_references: ['reference-description'], has_character_reference: 'Y', api_key: 'DO NOT INCLUDE' } },
    scriptRecord: { id: 'recS', fields: { video_id: 'video', status: 'Approved', estimated_duration_seconds: 3, voiceover_script: frame.narration, scenes_json: JSON.stringify([{ scene_number: 1, duration_seconds: 3, narration: frame.narration }]) } },
    storyboardRecord: { id: 'recB', fields: { storyboard_id: 'video', storyboard_text: JSON.stringify(output) } },
    brief: { workflow: 'narrated-video', structures, guidancePacks: ['motion-endpoints@1'] } };
}
const issueFor = input => ({ severity: 'editorial', category: 'continuity', scene_id: 1, frame_id: 1, panel_id: null,
  pointer: '/storyboard/structure1/0/image_prompt', time_range: { start_seconds: 0, end_seconds: 3 },
  evidence: input.storyboard.structure1[0].image_prompt, explanation: 'The opening state needs a clearer hand position.',
  suggested_fix: 'Describe the hand above the cardboard.', fix_owner: 'storyboard' });

test('canonical input hashes retain content/brief dependencies and ignore lifecycle and secret fields', () => {
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
  const source = fixture(), first = buildAuditInput(source);
  assert.ok(first.deterministic_checks.every(row => row.passed));
  assert.ok(!JSON.stringify(first).includes('DO NOT INCLUDE'));
  assert.equal(first.project.channel_page_name, 'DIY');
  assert.deepEqual(first.project.character_references, ['reference-description']);
  source.scriptRecord.fields.status = 'Story Generated'; source.scriptRecord.fields.owner_label = 'Changed';
  source.projectRecord.fields.updated_at = 'later';
  assert.equal(buildAuditInput(source).package_hash, first.package_hash);
  source.scriptRecord.fields.title = 'Changed approved content';
  assert.notEqual(buildAuditInput(source).package_hash, first.package_hash);
  source.brief.guidancePacks = ['motion-endpoints@2'];
  assert.notEqual(buildAuditInput(source).brief_hash, first.brief_hash);
});

test('all selected representations audit under distinct contracts and legacy image aliases normalize without mutation', () => {
  for (const structures of [['structure1'], ['structure2'], ['structure3'], ['structure1', 'structure2', 'structure3']]) {
    const input = buildAuditInput(fixture(structures));
    assert.ok(input.deterministic_checks.every(row => row.passed), JSON.stringify(input.deterministic_checks));
    const report = acceptAuditReport(validAuditReport(input), input);
    assert.equal(report.verdict, 'PASS');
    assert.equal(report.dimensions.find(row => row.id === 'brand').score, null);
    assert.equal(report.dimensions.find(row => row.id === 'media').score, null);
    assert.ok(Math.abs(report.dimensions.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-10);
  }
  const source = fixture(); const raw = JSON.parse(source.storyboardRecord.fields.storyboard_text);
  raw.structure1[0].first_frame_prompt = raw.structure1[0].image_prompt; delete raw.structure1[0].image_prompt;
  source.storyboardRecord.fields.storyboard_text = raw;
  assert.ok(buildAuditInput(source).storyboard.structure1[0].image_prompt);
  assert.equal(raw.structure1[0].image_prompt, undefined);
});

test('model PASS and invented deterministic success cannot override hard coverage failures', () => {
  const source = fixture(); const raw = JSON.parse(source.storyboardRecord.fields.storyboard_text);
  raw.structure1[0].end_seconds = 2; source.storyboardRecord.fields.storyboard_text = JSON.stringify(raw);
  const input = buildAuditInput(source);
  const report = acceptAuditReport(validAuditReport(input, { verdict: 'PASS', deterministic_checks: [{ passed: true }] }), input);
  assert.equal(report.verdict, 'BLOCKED'); assert.ok(report.deterministic_checks.some(row => !row.passed));
  const missing = fixture(); missing.scriptRecord.fields.scenes_json = '[]';
  const missingInput = buildAuditInput(missing);
  assert.equal(acceptAuditReport(validAuditReport(missingInput), missingInput).verdict, 'BLOCKED');
});

test('source-linked issues have stable IDs, valid timing and conservative editorial review', () => {
  const input = buildAuditInput(fixture()); const issue = issueFor(input);
  const report = acceptAuditReport(validAuditReport(input, { issues: [issue] }), input);
  assert.equal(report.verdict, 'NEEDS_REVIEW'); assert.equal(report.human_review_required, true);
  const copy = acceptAuditReport(validAuditReport(input, { issues: [{ ...issue, explanation: 'Edited explanation' }] }), input);
  assert.equal(copy.issues[0].id, report.issues[0].id);
  assert.equal(acceptAuditReport(validAuditReport(input, { human_review_required: true }), input).verdict, 'NEEDS_REVIEW');
  const low = validAuditReport(input); low.dimensions[0].score = 2;
  assert.equal(acceptAuditReport(low, input).verdict, 'NEEDS_REVIEW');
});

test('malformed, forged, duplicate, unlocated, overlarge and unsupported evidence is rejected', () => {
  const input = buildAuditInput(fixture());
  const mutations = [
    report => { report.package_hash = 'forged'; },
    report => { report.structure_types = ['structure3']; },
    report => { report.dimensions[1] = report.dimensions[0]; },
    report => { report.dimensions[0].evidence = []; },
    report => { report.dimensions[0].evidence[0].quote = 'invented evidence'; },
    report => { report.dimensions[0].evidence[0].pointer = '/storyboard/nope'; },
    report => { report.dimensions[6].score = 10; },
    report => { report.dimensions[6].evidence = report.dimensions[0].evidence; },
    report => { report.issues = [{ ...issueFor(input), related_evidence: [{ pointer: '/storyboard/structure1/0/video_prompt', quote: 'Invented counterpart' }] }]; },
    report => { report.issues = [{ ...issueFor(input), scene_id: 50 }]; },
    report => { report.issues = [{ ...issueFor(input), time_range: { start_seconds: 0, end_seconds: 4 } }]; },
    report => { report.issues = [issueFor(input), issueFor(input)]; },
    report => { report.evidence_limits = ['x'.repeat(61_000)]; },
    report => { report.dimensions[0].score = '9'; },
    report => { report.dimensions[0].rule_ids = ['invented-rule']; },
  ];
  for (const mutate of mutations) { const report = validAuditReport(input); mutate(report); assert.throws(() => acceptAuditReport(report, input), error => error.code === 'AUDIT_INVALID_REPORT'); }
  const unknown = validAuditReport(input); unknown.dimensions[0].score = null; unknown.dimensions[0].evidence = [];
  assert.equal(acceptAuditReport(unknown, input).verdict, 'NEEDS_REVIEW');
});

test('one audit call receives complete untrusted input, structure-specific A/B rules and no rewrite loop', async () => {
  const input = buildAuditInput(fixture()); let calls = 0;
  const gemini = { generate: async ({ system, prompt, json }) => {
    calls++; assert.equal(system, STORYBOARD_AUDIT_SYSTEM); assert.equal(json, true);
    assert.match(system, /OPENING state/); assert.match(system, /Never require B per keyframe/);
    assert.deepEqual(JSON.parse(prompt.split('AUDIT_INPUT_JSON:\n')[1]), input); return validAuditReport(input);
  } };
  assert.equal((await storyboardAuditAgent(gemini, input)).verdict, 'PASS'); assert.equal(calls, 1);
  const oversized = { ...input, extra: 'x'.repeat(MAX_AUDIT_INPUT_BYTES) };
  await assert.rejects(storyboardAuditAgent(gemini, oversized), error => error.code === 'AUDIT_INPUT_TOO_LARGE');
  assert.equal(calls, 1);
  await assert.rejects(storyboardAuditAgent({ generate: async () => ({ verdict: 'PASS' }) }, input), error => error.code === 'AUDIT_INVALID_REPORT');
});

test('A/B contradiction evidence binds both exact prompt states to the actual package', () => {
  const source = fixture();
  const packageData = JSON.parse(source.storyboardRecord.fields.storyboard_text);
  packageData.structure1[0].image_prompt = 'The cardboard already bears the finished pencil mark.';
  source.storyboardRecord.fields.storyboard_text = JSON.stringify(packageData);
  const input = buildAuditInput(source);
  const issue = { ...issueFor(input), category: 'prompt_alignment', explanation: 'A already shows the finished mark, but B begins drawing it.',
    suggested_fix: 'Show unmarked cardboard in A.', related_evidence: [{ pointer: '/storyboard/structure1/0/video_prompt', quote: input.storyboard.structure1[0].video_prompt }] };
  const report = acceptAuditReport(validAuditReport(input, { issues: [issue] }), input);
  assert.equal(report.verdict, 'NEEDS_REVIEW');
  assert.deepEqual(report.issues[0].related_evidence, issue.related_evidence);
});

test('revoked approval invalidates the audit dependency while completed lifecycle keeps its hash', () => {
  const source = fixture(); const approved = buildAuditInput(source);
  source.scriptRecord.fields.status = 'Story Generated';
  assert.equal(buildAuditInput(source).package_hash, approved.package_hash);
  source.scriptRecord.fields.status = 'Draft';
  const revoked = buildAuditInput(source);
  assert.notEqual(revoked.package_hash, approved.package_hash);
  assert.equal(revoked.deterministic_checks.find(row => row.id === 'approved_script').passed, false);
  assert.equal(acceptAuditReport(validAuditReport(revoked, { verdict: 'PASS' }), revoked).verdict, 'BLOCKED');
});

test('audit prompt explicitly distinguishes string actions and zero-based evidence indices', () => {
  const prompt = buildStoryboardAuditPrompt({});
  assert.match(prompt,/prioritized_actions MUST be an array/);
  assert.match(prompt,/plain strings/);
  assert.match(prompt,/ZERO-BASED/);
  assert.match(prompt,/different namespaces/);
  assert.ok(prompt.includes('"rule_ids":["media"]'));
  assert.ok(prompt.includes('"rule_ids":["continuity"]'));
  assert.match(prompt,/Scene 1 in structure1 is \/storyboard\/structure1\/0/);
});
