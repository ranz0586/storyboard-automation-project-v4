import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptValidationAgent } from '../src/agents/scriptValidation/index.js';
import { processIdeaScript } from '../src/scriptWorker.js';
import { SCRIPT_SYSTEM } from '../src/agents/script/system.js';
import { SCRIPT_VALIDATION_SYSTEM } from '../src/agents/scriptValidation/system.js';
import { editorialReply, claimReply, withScriptValidation } from './helpers/scriptValidation.js';
import { researchEvidence, conceptEvidence } from '../src/utils/evidence.js';
import { flattenConcept, unflattenIdea } from '../src/transforms.js';
import { generateIdeasForProject } from '../src/ideaGeneration.js';

function script(narration = 'Water might behave differently when pressure changes nearby.') {
  return { video: { video_id: 'editorial-test', title: 'Water', estimated_duration_seconds: 3, voiceover: { full_script: narration } }, scenes: [{ scene_number: 1, duration_seconds: 3, narration, tts: { pause_after_ms: 100 }, visual: { description: 'Water in a pressure chamber', image_prompt: 'Water in a pressure chamber', video_prompt: 'Show water in a pressure chamber' } }] };
}
function reply(candidate, history = []) {
  return { approved: true, script: structuredClone(candidate), issues: [], editorial_review: editorialReply(candidate, history), scene_reviews: candidate.scenes.map(scene => ({ ...claimReply(scene), scene_number: scene.scene_number, visuals_match_narration: true, single_visual_moment: true, reason: 'Visuals support this useful final beat', claim_type: 'hypothesis' })) };
}
const form = { NICHE: 'Science', PLATFORM: 'YouTube Shorts' };
const metadata = { url: 'https://www.youtube.com/watch?v=test', title: 'Water expiration date', view_count: 120 };

test('the live bottled-water assertion cannot gain factual support from a video title or invented quote', async () => {
  const candidate = script('Bacteria cannot grow inside sealed, pure mineral water.');
  const concept = { evidence: researchEvidence({ videos: [metadata] }) };
  let calls = 0, writes = 0;
  await assert.rejects(processIdeaScript({ idea: { id: 'recPhase3Bottle' }, projectKey: 'science', concept, form,
    gemini: { generate: async ({ system }) => {
      if (system === SCRIPT_SYSTEM) return { scripts: [candidate] };
      calls++; const output = reply(candidate);
      Object.assign(output.scene_reviews[0], { claim_type: 'factual', support_matches_claim: true, supports: [{ source_url: metadata.url, quote: metadata.title }] });
      return output;
    } }, airtable: { findScriptByVideoId: async () => null, upsertScript: async () => { writes++; } },
  }), /matching supplied excerpt/);
  assert.equal(calls, 2); assert.equal(writes, 0);
});
test('supported factual excerpts survive Idea persistence and validation; model-invented sources are discarded', async () => {
  const narration = 'Water changes state when pressure changes around it.';
  const source = { url: 'https://example.test/source', excerpt: 'Observation: ' + narration };
  const evidence = conceptEvidence({ factual_sources: [{ url: 'https://invented.test', excerpt: 'invented' }] }, researchEvidence({ factual_sources: [source] }));
  const concept = unflattenIdea({ fields: flattenConcept({ title: 'Water', evidence }, { form, projectKey: 'science' }) });
  assert.deepEqual(concept.evidence.factual_sources, [source]);
  const candidate = script(narration), output = reply(candidate);
  Object.assign(output.scene_reviews[0], { claim_type: 'factual', support_matches_claim: true, supports: [{ source_url: source.url, quote: narration }] });
  const result = await scriptValidationAgent({ generate: async () => structuredClone(output) }, { script: candidate, concept, form });
  assert.equal(result.scenes[0].editorial_review.claim_type, 'factual');
  assert.ok(result.scenes[0].editorial_review.summary.originality_reason);
  for (const change of [r => { r.scene_reviews[0].supports[0].quote = 'An invented supporting fact'; }, r => { r.scene_reviews[0].supports[0].source_url = 'https://invented.test'; }, r => { r.scene_reviews[0].support_matches_claim = false; }]) {
    const bad = structuredClone(output); change(bad);
    await assert.rejects(scriptValidationAgent({ generate: async () => structuredClone(bad) }, { script: candidate, concept, form }), /Script validation failed/);
  }
});
test('missing editorial review, misleading hooks, padding, repeated treatments and incomplete history comparisons cannot pass', async () => {
  const candidate = script(), history = [{ id: 'recPrior', title: 'Similar premise' }];
  for (const mutate of [
    r => { delete r.editorial_review; },
    r => { r.editorial_review.hook_fulfilled = false; },
    r => { r.editorial_review.hook_quote = 'A promise absent from this script'; },
    r => { r.editorial_review.payoff_scene_number = 99; },
    r => { r.editorial_review.payoff_quote = 'An absent explanation'; },
    r => { r.scene_reviews[0].useful_narration = false; },
    r => { r.editorial_review.distinct_treatment = false; },
    r => { r.editorial_review.compared_record_ids = []; },
    r => { r.editorial_review.compared_record_ids = ['recInvented']; },
    r => { r.scene_reviews[0].narration = 'A different scene'; },
    r => { r.scene_reviews[0].claim_type = 'unsupported'; },
    r => { r.scene_reviews[0].claim_type = 'silent'; },
    r => { r.scene_reviews[0].sensitive_claim = true; },
    r => { r.scene_reviews[0].claim_type = 'instruction'; r.scene_reviews[0].sensitive_claim = true; },
  ]) {
    let calls = 0;
    await assert.rejects(scriptValidationAgent({ generate: async () => { calls++; const output = reply(candidate, history); mutate(output); return output; } }, { script: candidate, concept: {}, form, recentContent: history }), /Script validation failed/);
    assert.equal(calls, 2);
  }
});
test('one correction repairs an editorial failure without more generation; immediate payoff and optional CTA remain valid', async () => {
  const candidate = script();let calls = 0;
  const result = await scriptValidationAgent({ generate: async ({prompt}) => {
    const output = reply(candidate); calls++;
    if(calls === 1) output.scene_reviews[0].useful_narration = false;
    else assert.match(prompt, /remove filler, repeated premises or padding/);
    return output;
  } }, { script: candidate, concept: {}, form });
  assert.equal(calls, 2);assert.equal(result.scenes.length, 1);
  assert.equal(result.scenes[0].editorial_review.summary.payoff_scene_number, 1);
});
test('bare assertions cannot be relabeled hypotheses, and unavailable metrics cannot be supported by metadata', async () => {
  const candidate = script('Water changes state when pressure changes around it.');
  await assert.rejects(scriptValidationAgent({generate: async () => reply(candidate)}, {script: candidate, concept: {}, form}), /speculation must be explicit/);
  for (const field of ['retention', 'comment_sentiment', 'growth', 'facebook_performance']) {
    const output = reply(script()); Object.assign(output.scene_reviews[0], {claim_type:'metadata',support_matches_claim:true,supports:[{source_url:metadata.url,field,quote:'99'}]});
    await assert.rejects(scriptValidationAgent({generate: async () => structuredClone(output)}, {script:script(),concept:{evidence:{observations:[metadata]}},form}), /metadata citation must match/);
  }
});
test('history is passed to idea generation and refreshed for the shared Script worker, excluding its own Idea', async () => {
  const history=[{id:'recPrior',title:'Prior video',treatment:'Existing explanation'}];let ideaPrompt,validationPrompt,historyCalls=[];
  const project={id:'recProject',fields:{project_id:'science',niche:'Science'}};
  const airtable={recentProjectContent: async (key,options) => {historyCalls.push({key,options});return history;},upsertIdea:async fields=>({id:'recPhase3History',fields}),findScriptByVideoId:async()=>null,upsertScript:async fields=>({id:'recSaved',fields})};
  await generateIdeasForProject({project,count:1,airtable,gemini:{generate:async ({prompt})=>{if(prompt.startsWith('Plan YouTube'))return [];if(prompt.startsWith('Research trending'))return {};ideaPrompt=prompt;return {concepts:[{title:'New explanation'}]};}}});
  assert.ok(ideaPrompt.includes('Prior video')); assert.match(ideaPrompt,/editorial ranking, not predicted/);
  const gemini=withScriptValidation(async()=>({scripts:[script()]}));
  const result=await processIdeaScript({idea:{id:'recPhase3History'},concept:{},form,projectKey:'science',airtable,gemini:{generate:async args=>{if(args.system===SCRIPT_VALIDATION_SYSTEM)validationPrompt=args.prompt;return gemini.generate(args);}}});
  assert.ok(result.generated);assert.ok(validationPrompt.includes('Prior video'));
  assert.deepEqual(historyCalls,[{key:'science',options:undefined},{key:'science',options:{excludeIdeaId:'recPhase3History',excludeVideoId:'idea_recPhase3History'}}]);
});
test('history failures stop new generation instead of silently approving blind originality checks', async () => {
  let calls = 0,writes=0;
  await assert.rejects(processIdeaScript({idea:{id:'recPhase3HistoryFailure'},concept:{},form,projectKey:'science',gemini:{generate:async()=>{calls++;}},airtable:{findScriptByVideoId:async()=>null,recentProjectContent:async()=>{throw Error('History unavailable');},upsertScript:async()=>{writes++;}}}),/History unavailable/);
  assert.equal(calls,0);assert.equal(writes,0);
});
