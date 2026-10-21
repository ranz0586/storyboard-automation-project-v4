import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertUsableStoryboard, isUsableStoryboardRecord, approvedScriptTimeline } from '../src/utils/storyboardValidation.js';
import { processScriptStoryboard } from '../src/storyboardWorker.js';
import { buildStoryboardPrompt } from '../src/agents/storyboard/prompt.js';
import { storyboardReply } from './helpers/storyboard.js';

function source(durations = [3, 2, 3]) {
  const narrations = ['Look at the water in this glass.', '', 'Now follow the light through the glass.'];
  const scenes = durations.map((duration, index) => ({ scene_number: index + 1, duration_seconds: duration, narration: narrations[index] }));
  return { id: 'recFidelity', fields: { video_id: 'phase4-video', status: 'Approved', Projects: 'science',
    estimated_duration_seconds: durations.reduce((a,b)=>a+b,0), scenes_json: JSON.stringify(scenes), voiceover_script: narrations.join(' ') } };
}
function groupPanels(output) {
  for(const name of ['structure2','structure3']) {
    const panel = output[name][0];
    output[name] = [{...panel,time_range:'0-5',keyframes:panel.keyframes.slice(0,2)}, {...panel,panel:2,time_range:'5-8',keyframes:panel.keyframes.slice(2)}];
  }
  return output;
}

test('every supported format independently covers the approved scenes, including silent beats and grouped panels', () => {
  const script=source(),output=groupPanels(storyboardReply(script));
  for(const format of ['structure1','structure2','structure3']) assert.deepEqual(assertUsableStoryboard({[format]:output[format]},script)[format],output[format]);
  assert.deepEqual(assertUsableStoryboard(output,script),output);
  assert.equal(output.structure3[0].keyframes[1].caption_narration,'');
  assert.deepEqual(approvedScriptTimeline(script).map(row=>[row.start,row.end]),[[0,3],[3,5],[5,8]]);
});
test('clock ranges, decimal seconds, Unicode separators and frame start-point timestamps preserve source timing', () => {
  const script=source([3.125,2.25,3.125]),output=storyboardReply(script);
  output.structure1[0].timestamp='00:00.000 – 00:03.125';
  output.structure1[1].timestamp='00:00:03.125 → 00:00:05.375';
  output.structure1[2].timestamp='00:05.375';
  output.structure2[0].time_range='0 to 8.5';
  assert.doesNotThrow(()=>assertUsableStoryboard(output,script));
});
test('missing, duplicate, extra and reordered scenes fail even when another alternative is complete', () => {
  for(const name of ['structure1','structure2','structure3']) for(const change of ['missing','duplicate','extra','reordered']) {
    const script=source(),output=storyboardReply(script);
    const frames=name==='structure1'?output[name]:output[name][0].keyframes;
    if(change==='missing') frames.pop();
    if(change==='duplicate') frames[1]=structuredClone(frames[0]);
    if(change==='extra') frames.push(structuredClone(frames[0]));
    if(change==='reordered') [frames[0],frames[1]]=[frames[1],frames[0]];
    assert.throws(()=>assertUsableStoryboard(output,script),/Storyboard fidelity/,name+': '+change);
  }
});
test('changed, missing or added narration cannot pass in detailed frames, captions or optional panel narration', () => {
  for(const change of [
    o=>{o.structure1[0].narration='A rewritten opening';},
    o=>{delete o.structure1[0].narration;},
    o=>{o.structure3[0].keyframes[0].caption_narration='A rewritten caption';},
    o=>{o.structure3[0].keyframes[1].caption_narration='Added words over the silent beat';},
    o=>{o.structure2[0].narration='An invented voiceover';},
    o=>{o.structure3[0].keyframes[0].narration='Conflicts with caption_narration';},
  ]) {const script=source(),output=storyboardReply(script);change(output);assert.throws(()=>assertUsableStoryboard(output,script),/narration|caption_narration/);}
  const script=source(),output=storyboardReply(script);output.structure1[0].narration='  Look at the water\n in this glass.  ';
  assert.doesNotThrow(()=>assertUsableStoryboard(output,script));
});
test('gaps, overlaps, out-of-range times, contradictory aliases, malformed timestamps and wrong totals fail', () => {
  for(const change of [
    o=>{o.structure1[0].timestamp='1-3';},
    o=>{o.structure1[0].timestamp='0-4';},
    o=>{o.structure1[0].timestamp='-1-3';},
    o=>{o.structure1[0].timestamp='00:70-00:73';},
    o=>{o.structure1[0].timestamp='NaN';},
    o=>{o.structure1[0].time_range='0-2';},
    o=>{o.structure1[0].duration_seconds=4;},
    o=>{o.structure1[0].scene_number=2;},
    o=>{o.structure2[0].time_range='1-8';},
    o=>{o.structure3[0].time_range='0-9';},
    o=>{o.structure3[0].panel_number=2;},
    o=>{o.structure3[0].keyframes[1].time_range='2-5';},
    o=>{o.estimated_duration_seconds=9;},
  ]) {const script=source(),output=storyboardReply(script);change(output);assert.throws(()=>assertUsableStoryboard(output,script),/Storyboard fidelity/);}
});
test('panel membership, numbering, detailed keyframes and image prompts are checked', () => {
  for(const change of [
    o=>{o.structure2[1].panel=1;},
    o=>{o.structure3[1].panel=4;},
    o=>{o.structure2[0].time_range='0-3';},
    o=>{o.structure3[0].keyframes=[];},
    o=>{o.structure3[0].keyframes[0]=1;},
    o=>{o.structure3[0].keyframes[0].image_prompt=' ';},
  ]) {const script=source(),output=groupPanels(storyboardReply(script));change(output);assert.throws(()=>assertUsableStoryboard(output,script),/Storyboard fidelity/);}
});
test('structure2 object references may preserve narration and explicit scene ranges without requiring a new output format', () => {
  const script=source(),output=storyboardReply(script);
  output.structure2[0].keyframes=output.structure1.map(frame=>({...frame}));
  assert.doesNotThrow(()=>assertUsableStoryboard({structure2:output.structure2},script));
  output.structure2[0].keyframes[0].timestamp='0-2';
  assert.throws(()=>assertUsableStoryboard(output,script),/must match/);
});
test('missing or inconsistent approved Script timelines fail before Gemini or persistence', async () => {
  for(const mutate of [
    f=>{delete f.scenes_json;},f=>{f.scenes_json='broken';},f=>{f.scenes_json='[]';},f=>{f.scenes_json='[null]';},
    f=>{f.estimated_duration_seconds=9;},f=>{f.voiceover_script='Different words';},
    f=>{const scenes=JSON.parse(f.scenes_json);scenes[0].duration_seconds=0;f.scenes_json=JSON.stringify(scenes);},
    f=>{const scenes=JSON.parse(f.scenes_json);scenes[0].scene_number=2;f.scenes_json=JSON.stringify(scenes);},
  ]) {
    const script=source();mutate(script.fields);let calls=0,writes=0;
    await assert.rejects(processScriptStoryboard({scriptRecord:script,withLock:async(_key,work)=>work(),clients:{gemini:{generate:async()=>{calls++;}},airtable:{getScript:async()=>script,upsertStoryboard:async()=>{writes++;}}}}),/Storyboard fidelity/);
    assert.equal(calls,0);assert.equal(writes,0);
  }
});
test('failed generated fidelity never upserts or advances Approved status', async () => {
  for(const change of [o=>{o.structure1.pop();},o=>{o.structure3[0].keyframes[0].caption_narration='Rewritten';},o=>{o.structure2[0].time_range='0-7';}]) {
    const script=source(),output=storyboardReply(script);change(output);let writes=0,updates=0;
    await assert.rejects(processScriptStoryboard({scriptRecord:script,withLock:async(_key,work)=>work(),clients:{gemini:{generate:async()=>output},airtable:{getScript:async()=>script,findProjectByKey:async()=>({id:'recProject',fields:{project_id:'science'}}),findStoryboardById:async()=>null,upsertStoryboard:async()=>{writes++;},updateScript:async()=>{updates++;}}}}),/Storyboard fidelity/);
    assert.equal(writes,0);assert.equal(updates,0);assert.equal(script.fields.status,'Approved');
  }
});
test('cached output is checked against the current approved Script and reused only when faithful', async () => {
  const script=source(),correct=storyboardReply(script),wrong=structuredClone(correct);wrong.structure1[0].narration='Old narration';
  assert.equal(isUsableStoryboardRecord({id:'recBoard',fields:{storyboard_id:script.fields.video_id,storyboard_text:JSON.stringify(wrong)}},script.fields.video_id,script),false);
  for(const cached of [correct,wrong]) {
    let generated=0,writes=0,updates=0;
    const result=await processScriptStoryboard({scriptRecord:script,withLock:async(_key,work)=>work(),clients:{gemini:{generate:async()=>{generated++;return correct;}},airtable:{getScript:async()=>script,findProjectByKey:async()=>({id:'recProject',fields:{project_id:'science'}}),findStoryboardById:async()=>({id:'recSaved',fields:{storyboard_id:script.fields.video_id,storyboard_text:JSON.stringify(cached)}}),upsertStoryboard:async fields=>{writes++;return{id:'recSaved',fields};},updateScript:async()=>{updates++;}}}});
    assert.equal(result.generated,cached===wrong);assert.equal(generated,cached===wrong?1:0);assert.equal(writes,generated);assert.equal(updates,1);
  }
});
test('generation prompt includes the authoritative timeline and per-format fidelity requirements', () => {
  const script=source(),prompt=buildStoryboardPrompt({scriptRecord:script});
  assert.ok(prompt.includes(JSON.stringify(approvedScriptTimeline(script))));
  assert.match(prompt,/Every populated structure must independently cover all approved scenes exactly once/);
  assert.match(prompt,/global frame number/);
  assert.match(prompt,/do not round fractional boundaries/);
});
