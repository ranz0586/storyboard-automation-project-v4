import test from 'node:test';
import assert from 'node:assert/strict';
import {guidanceFor} from '../src/creativeGuidance/index.js';
import {buildStoryboardPrompt} from '../src/agents/storyboard/prompt.js';
import {storyboardAgent} from '../src/agents/storyboard/index.js';
import {STORYBOARD_SYSTEM} from '../src/agents/storyboard/system.js';
import {storyboardReply} from './helpers/storyboard.js';
const scene={scene_number:1,duration_seconds:3,narration:'Imagine the rule ending; our paperclip settles back.',visual:{initial_state:'The red paperclip is near the clear lid.',final_state:'The red paperclip rests flat on the floor.',motion:{subject:'Descend and land.',camera:'Tilt down.',environment:'Still.'},image_prompt:'The red paperclip rests flat on the floor.',video_prompt:'The red paperclip descends and lands.'}};
const script={fields:{video_id:'test-opening',status:'Approved',estimated_duration_seconds:3,voiceover_script:scene.narration,scenes_json:JSON.stringify([scene])}};

test('writer, review and storyboard prompts consistently require the opening image rather than the completed action',()=>{
 for(const role of ['script','validation','storyboard']){
  const prompt=guidanceFor(role,{guidancePacks:['motion-endpoints@1']});
  assert.match(prompt,/OPENING FRAME CONTRACT/);assert.match(prompt,/image_prompt.*initial_state/);assert.match(prompt,/Do not depict the completed action/);assert.match(prompt,/Structure 2.*no.*image Prompt A/);
 }
});
test('approved initial states override contradictory image suggestions in storyboard conversion without changing the Script',async()=>{
 const before=structuredClone(script);let captured;
 await storyboardAgent({generate:async args=>{captured=args;return storyboardReply(script);}},{scriptRecord:script,brief:{structures:['structure1'],identity:{},guidancePacks:['motion-endpoints@1']}});
 assert.ok(captured.system.startsWith(STORYBOARD_SYSTEM));assert.match(captured.system,/OPENING FRAME CONTRACT/);
 const data=JSON.parse(captured.prompt.split('APPROVED VISUAL STATE MAP (authoritative opening, motion, ending):\n')[1].split('\n')[0]);
 assert.deepEqual(data,[{scene_number:1,initial_state:scene.visual.initial_state,motion:scene.visual.motion,final_state:scene.visual.final_state}]);
 assert.match(captured.prompt,/takes precedence over.*image_prompt/);assert.deepEqual(script,before);
 const legacy=structuredClone(script);delete legacy.fields.scenes_json;legacy.fields.scenes_json=JSON.stringify([{...scene,visual:{}}]);
 const prompt=buildStoryboardPrompt({scriptRecord:legacy,brief:{identity:{}}});assert.ok(prompt.includes('APPROVED VISUAL STATE MAP (authoritative opening, motion, ending):\n[]'));assert.match(prompt,/derive.*opening.*approved action/);
});
