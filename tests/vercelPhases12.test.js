import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptValidationAgent } from '../src/agents/scriptValidation/index.js';
import { GeminiClient } from '../src/clients/gemini.js';
import { ideaAgent } from '../src/agents/idea/index.js';
import { editorialReply, claimReply, scriptFromValidationPrompt } from './helpers/scriptValidation.js';
import { assertUsableStoryboard, isUsableStoryboardRecord } from '../src/utils/storyboardValidation.js';
import { storyboardReply } from './helpers/storyboard.js';

const form = { NICHE: 'Science', 'PRODUCTION BRIEF': { language: 'Tagalog' } };
function script(durations = [3]) {
  const scenes = durations.map((duration_seconds, i) => {
    const narration = Array(Math.floor(duration_seconds * 3)).fill('water').join(' ');
    return { scene_number: i + 1, duration_seconds, narration,
      visual: { description: 'A careful demonstration', image_prompt: 'A clear still', video_prompt: 'Demonstrate' } };
  });
  return { video: { video_id: 'v12', title: 'Demonstration', estimated_duration_seconds: durations.reduce((a,b)=>a+b,0),
    voiceover: { full_script: scenes.map(s=>s.narration).join(' ') } }, scenes };
}
function review(value, history = []) {
  return { approved: true, script: structuredClone(value), issues: [], editorial_review: editorialReply(value, history),
    scene_reviews: value.scenes.map(scene=>({ ...claimReply(scene), scene_number: scene.scene_number,
      visuals_match_narration: true, single_visual_moment: true, reason: 'Matches final narration' })) };
}
const validate = (candidate, generate) => scriptValidationAgent({ generate }, { script: candidate, concept: {}, form });

test('V1 mixed source durations, silent beats and split source associations survive review', async () => {
  const candidate = script([2,3,5]);
  candidate.scenes[1].narration = '';
  candidate.video.voiceover.full_script = candidate.scenes.map(s=>s.narration).join(' ');
  const result = await validate(candidate, async()=>review(candidate));
  assert.deepEqual(result.scenes.map(s=>s.duration_seconds),[2,3,5]);
  assert.equal(result.scenes[1].tts.speaking_rate_wpm,0);
  for(const mutate of [
    r=>{r.scene_reviews[2].source_scene_number=2;},
    r=>{r.scene_reviews[0].source_scene_number=3;},
    r=>{r.scene_reviews[2].source_scene_number=99;},
  ]) await assert.rejects(validate(candidate,async()=>{const r=review(candidate);mutate(r);return r;}),/original scene duration and source order/);
  const original=script([3]),split=script([3,3]),reply=review(split);
  reply.scene_reviews.forEach(r=>{r.source_scene_number=1;});
  assert.equal((await validate(original,async()=>structuredClone(reply))).scenes.length,2);
});

test('V1 hypotheses use final-language quotes and still reject sensitive unsupported advice', async () => {
  const candidate=script();
  candidate.scenes[0].narration='Maaaring magbago ito kapag iba ang presyon dito.';
  candidate.video.voiceover.full_script=candidate.scenes[0].narration;
  const response=review(candidate);
  Object.assign(response.scene_reviews[0],{claim_type:'hypothesis',uncertainty_explicit:true,uncertainty_quote:'Maaaring'});
  assert.equal((await validate(candidate,async()=>structuredClone(response))).scenes[0].narration,candidate.scenes[0].narration);
  for(const mutate of [
    r=>{r.scene_reviews[0].uncertainty_quote='absent phrase';},
    r=>{r.scene_reviews[0].uncertainty_explicit=false;},
    r=>{r.scene_reviews[0].sensitive_claim=true;},
    r=>{r.editorial_review.hook_scene_number=2;},
  ]) await assert.rejects(validate(candidate,async()=>{const r=structuredClone(response);mutate(r);return r;}),/Script validation failed/);
});

test('V1 compact pacing correction requires fresh complete final reviews and has no provider responseSchema', async () => {
  const candidate=script([3,3]);
  candidate.scenes[0].narration='This clear water slowly moves through the chamber';
  candidate.scenes[0].tts={pause_after_ms:100};
  candidate.scenes[1].tts={pause_after_ms:100};
  candidate.scenes[1].narration='Watch the water move inside this clear chamber';
  candidate.video.voiceover.full_script=candidate.scenes.map(s=>s.narration).join(' ');
  // First scene: nine words exceed the pause-adjusted eight-word maximum.
  candidate.scenes[0].narration+=' today';
  candidate.video.voiceover.full_script=candidate.scenes.map(s=>s.narration).join(' ');
  const fixed=structuredClone(candidate);
  fixed.scenes[0].narration='Water gently moves through this clear chamber today';
  fixed.video.voiceover.full_script=fixed.scenes.map(s=>s.narration).join(' ');
  let calls=0;
  const provider=async args=>{
    calls++;
    assert.equal(args.responseSchema,undefined);
    if(calls===1)return review(candidate);
    assert.match(args.prompt,/COMPACT RESPONSE FORMAT/);
    const r=review(fixed);
    return {approved:true,issues:[],repairs:{scene_1:{words:fixed.scenes[0].narration.split(' '),visual:fixed.scenes[0].visual,
      visuals_match_narration:true,single_visual_moment:true,reason:'Updated visual'}},scene_reviews:r.scene_reviews,editorial_review:r.editorial_review};
  };
  assert.equal((await validate(candidate,provider)).scenes[0].narration,fixed.scenes[0].narration);
  assert.equal(calls,2);
  for(const stale of [true,false]){
    let attempts=0;
    await assert.rejects(validate(candidate,async args=>{
      if(++attempts===1)return review(candidate);
      const r=review(fixed);
      if(stale)r.scene_reviews[0].narration=candidate.scenes[0].narration;else r.scene_reviews.pop();
      return {approved:true,issues:[],repairs:{scene_1:{words:fixed.scenes[0].narration.split(' '),visual:fixed.scenes[0].visual,
        visuals_match_narration:true,single_visual_moment:true,reason:'Updated visual'}},scene_reviews:r.scene_reviews,editorial_review:r.editorial_review};
    }),/Script validation failed/);
    assert.equal(attempts,2);
  }
});

test('V1 invalid JSON consumes at most two logical reviews; unrelated errors are not retried', async () => {
  const candidate=script();let calls=0;
  const result=await validate(candidate,async({prompt})=>{
    if(++calls===1)throw Object.assign(new Error('safe'),{code:'GEMINI_INVALID_JSON',model:'mock',finishReason:'MAX_TOKENS'});
    assert.match(prompt,/invalid JSON/);return review(scriptFromValidationPrompt(prompt));
  });
  assert.equal(result.video.video_id,'v12');assert.equal(calls,2);
  calls=0;
  await assert.rejects(validate(candidate,async()=>{calls++;throw new SyntaxError('malformed');}),/Script validation failed/);
  assert.equal(calls,2);
  calls=0;
  await assert.rejects(validate(candidate,async()=>{calls++;throw Error('provider unavailable');}),/provider unavailable/);
  assert.equal(calls,1);
  const { processIdeaScript }=await import('../src/scriptWorker.js');
  let writes=0;
  await assert.rejects(processIdeaScript({idea:{id:'recV1Malformed'},form,projectKey:'science',concept:{},withLock:async(_id,work)=>work(),
    gemini:{generate:async()=>{throw Object.assign(Error('safe parse metadata'),{code:'GEMINI_INVALID_JSON'});}},
    airtable:{findScriptByVideoId:async()=>null,upsertScript:async()=>{writes++;}}}),/Script generation failed: safe parse metadata/);
  assert.equal(writes,0);
  for(const count of [0,-1,1.5,NaN])await assert.rejects(ideaAgent({generate:async()=>{throw Error('must not call');}},{count}),/positive integer/);
});

test('V1 Gemini parse failure metadata is safe; valid fallback output still succeeds', async () => {
  const secret='RAW_PRIVATE_TEXT_MUST_NOT_APPEAR';
  const make=(fallbackValid=false)=>new GeminiClient({apiKeys:['synthetic'],primary:'primary',fallback:'fallback',
    keyPool:{size:1,acquire:async()=>({key:'synthetic',index:0})},
    modelFactory:({name})=>({generateContent:async()=>({response:{text:()=>fallbackValid&&name==='fallback'?'{"ok":true}':secret,candidates:[{finishReason:'MAX_TOKENS'}]}})})});
  await assert.rejects(make().generate({system:'test',prompt:'test',json:true}),err=>{
    assert.equal(err.code,'GEMINI_INVALID_JSON');assert.equal(err.model,'fallback');assert.equal(err.finishReason,'MAX_TOKENS');
    assert(!err.message.includes(secret));return true;
  });
  assert.deepEqual(await make(true).generate({system:'test',prompt:'test',json:true}),{ok:true});
});

const source=()=>{const s=script([2.5,3,2.5]);return {id:'recV12',fields:{video_id:'v12',scenes_json:JSON.stringify(s.scenes),estimated_duration_seconds:8,voiceover_script:s.video.voiceover.full_script}};};
function numeric(output){
  const value=structuredClone(output);
  const convert=item=>{const range=item.timestamp??item.time_range;if(range){const [a,b]=range.split(' - ');item.start_seconds=parseFloat(a);item.end_seconds=parseFloat(b);delete item.timestamp;delete item.time_range;}};
  value.structure1.forEach(convert);
  for(const key of ['structure2','structure3'])value[key].forEach(panel=>{convert(panel);if(key==='structure3')panel.keyframes.forEach(convert);});
  return value;
}
test('V2 clock and numeric timelines cover all seven format selections without mutating raw output',()=>{
  const record=source(),clock=storyboardReply(record),numbers=numeric(clock);
  for(let mask=1;mask<8;mask++){
    const structures=['structure1','structure2','structure3'].filter((_,i)=>mask&(1<<i));
    for(const all of [clock,numbers]){
      const packageValue=Object.fromEntries(structures.map(k=>[k,all[k]])),before=structuredClone(packageValue);
      assert.doesNotThrow(()=>assertUsableStoryboard(packageValue,record,{structures}));
      assert.deepEqual(packageValue,before);
    }
  }
  const point=structuredClone(clock);point.structure1[0].timestamp='0s';
  assert.doesNotThrow(()=>assertUsableStoryboard(point,record));
  point.structure2[0].time_range='0s';
  assert.throws(()=>assertUsableStoryboard(point,record),/must match/);
});
test('V2 contradictory numeric/clock/identity/narration/prompt aliases and incomplete ranges fail',()=>{
  const record=source();
  for(const mutate of [
    x=>{x.structure1[0].start_seconds=1;x.structure1[0].end_seconds=2.5;},
    x=>{x.structure1[0].start_seconds=0;},
    x=>{x.structure2[0].start_seconds=0;x.structure2[0].end_seconds=7;},
    x=>{x.structure3[0].keyframes[0].scene_number=2;},
    x=>{x.structure1[0].caption_narration='Changed';},
    x=>{x.structure1[0].first_frame_prompt='Contradictory image';},
    x=>{x.structure3[0].keyframes[0].end_seconds=2;},
  ]){const output=storyboardReply(record);mutate(output);assert.throws(()=>assertUsableStoryboard(output,record),/Storyboard fidelity/);}
  const output=numeric(storyboardReply(record));output.structure1[0].end_seconds=2;
  assert.throws(()=>assertUsableStoryboard(output,record),/numeric times must match/);
});
test('V2 legacy separate columns and first-frame aliases are reusable only against the approved source',()=>{
  const record=source(),output=numeric(storyboardReply(record));
  output.structure1.forEach(frame=>{frame.first_frame_prompt=frame.image_prompt;delete frame.image_prompt;});
  const fields={storyboard_id:'v12',storyboard_text:'Legacy summary',
    ...Object.fromEntries(['structure1','structure2','structure3'].map(k=>[k+'_json',JSON.stringify(output[k])]))};
  const cached={id:'recCache',fields},before=structuredClone(cached);
  assert(isUsableStoryboardRecord(cached,'v12',record));
  assert.deepEqual(cached,before);
  for (const summary of [undefined, '', '   ']) {
    const legacy=structuredClone(cached);legacy.fields.storyboard_text=summary;
    assert(isUsableStoryboardRecord(legacy,'v12',record));
  }
  fields.structure1_json='[invalid';
  assert(!isUsableStoryboardRecord(cached,'v12',record));
});


test('V2 numeric cache completes a lost status update without regeneration, while invalid replacement preserves cache', async()=>{
  const { processScriptStoryboard }=await import('../src/storyboardWorker.js');
  const record=source();record.fields.status='Approved';record.fields.Projects='science';
  const output=numeric(storyboardReply(record)),saved={id:'recSaved',fields:{storyboard_id:'v12',storyboard_text:JSON.stringify(output)}};
  let calls=0,writes=0,updates=0;
  const project={id:'recProject',fields:{project_id:'science'}};
  const airtable={getScript:async()=>record,findProjectByKey:async()=>project,findStoryboardById:async()=>saved,
    upsertStoryboard:async()=>{writes++;return saved;},updateScript:async()=>{updates++;}};
  const clients={airtable,gemini:{generate:async()=>{calls++;return output;}}};
  const options={scriptRecord:record,clients,withLock:async(_id,work)=>work()};
  assert.equal((await processScriptStoryboard(options)).generated,false);
  assert.deepEqual([calls,writes,updates],[0,0,1]);
  const wrong=structuredClone(output);wrong.structure1[0].narration='Changed';
  saved.fields.storyboard_text=JSON.stringify(wrong);
  const before=structuredClone(saved);
  clients.gemini.generate=async()=>{calls++;return wrong;};
  await assert.rejects(processScriptStoryboard(options),/changes approved narration/);
  assert.deepEqual(saved,before);assert.deepEqual([calls,writes,updates],[1,0,1]);
});
