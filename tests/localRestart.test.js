import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { login } from './helpers/session.js';

test('local HTTP server restart preserves progress, revokes sessions and resumes only unfinished work', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-restart-'));
  const children = [];
  const moduleUrl = relative => new URL(relative, import.meta.url).href;
  try {
    const worker = path.join(directory, 'server.mjs');
    fs.writeFileSync(worker, `import fs from 'node:fs';
process.env.SCRIPT_LOCK_DIR=${JSON.stringify(path.join(directory, 'script-locks'))};
const {createApp}=await import(${JSON.stringify(moduleUrl('../src/app.js'))});
const {RunStore}=await import(${JSON.stringify(moduleUrl('../src/runs/runStore.js'))});
const {ScheduleStore}=await import(${JSON.stringify(moduleUrl('../src/schedules/scheduleStore.js'))});
const {withScriptValidation}=await import(${JSON.stringify(moduleUrl('./helpers/scriptValidation.js'))});
const {userClient}=await import(${JSON.stringify(moduleUrl('./helpers/session.js'))});
const providerPath=${JSON.stringify(path.join(directory, 'provider.json'))};
if(!fs.existsSync(providerPath))fs.writeFileSync(providerPath,JSON.stringify({scripts:{},generations:0,completed:[]}));
const read=()=>JSON.parse(fs.readFileSync(providerPath));
const write=data=>fs.writeFileSync(providerPath,JSON.stringify(data));
const ideas=['localRestartOne','localRestartTwo'].map(id=>({id,fields:{title:id,niche:'Science',platform:'YouTube',Projects:'Science'}}));
const provider=userClient({
 getProject:async()=>({id:'recProject',fields:{project_id:'Science',status:'Active'}}),
 getIdea:async id=>ideas.find(idea=>idea.id===id),
 findScriptByVideoId:async id=>read().scripts[id]||null,
 upsertScript:async fields=>{const data=read();const record={id:'local_'+fields.video_id,fields};data.scripts[fields.video_id]=record;write(data);return record;},
 updateIdea:async id=>{const data=read();data.completed.push(id);write(data);},
});
const gemini=withScriptValidation(async({prompt})=>{
 const data=read();data.generations++;write(data);
 if(process.argv[2]==='initial'&&prompt.includes('localRestartTwo'))await new Promise(()=>{});
 return {scripts:[{video:{video_id:'generated',title:'Science script',estimated_duration_seconds:3,voiceover:{full_script:'Science narration'}},scenes:[{scene_number:1,duration_seconds:3,narration:'Science narration'}]}]};
});
const app=createApp({makeAirtable:()=>provider,makeGemini:()=>gemini,makeTelegram:()=>({scriptsGeneratedAlert:async()=>{},errorAlert:async()=>{}}),
 runStore:new RunStore({filePath:${JSON.stringify(path.join(directory, 'runs.json'))}}),scheduleStore:new ScheduleStore({filePath:${JSON.stringify(path.join(directory, 'schedules.json'))}}),authOptions:{secureCookies:false}});
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));`);
    async function launch(phase) {
      const child = fork(worker, [phase], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      children.push(child);
      const [message] = await once(child, 'message');
      return { child, base: `http://127.0.0.1:${message.port}` };
    }
    async function poll(base, id, headers, predicate) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await fetch(`${base}/api/script-runs/${id}`, { headers });
        assert.equal(response.status, 200);
        const { run } = await response.json();
        if (predicate(run)) return run;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Local run did not reach expected state');
    }
    const initial = await launch('initial');
    const headers = { ...await login(initial.base), 'content-type': 'application/json' };
    const accepted = await fetch(initial.base + '/api/script-runs', { method: 'POST', headers,
      body: JSON.stringify({ projectId: 'recProject', mode: 'selected', ideaIds: ['localRestartOne', 'localRestartTwo'] }) });
    assert.equal(accepted.status, 202);
    const { run } = await accepted.json();
    await poll(initial.base, run.id, headers, value => value.successfulCount === 1 && value.currentItem === 'localRestartTwo');
    // Wait for the fixture's second provider call, not merely lock creation.
    // A lock can exist before generation starts, especially under parallel test load.
    const lock = path.join(directory, 'script-locks', createHash('sha256').update('idea_localRestartTwo').digest('hex'));
    const started=()=>fs.existsSync(lock)&&JSON.parse(fs.readFileSync(path.join(directory,'provider.json'))).generations===2;
    for(let attempt=0;attempt<100&&!started();attempt++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(started(),'second provider call must start before crashing');
    const exited = once(initial.child, 'exit'); initial.child.kill(); await exited;
    // Advance only the isolated abandoned lock's lease. Production keeps the
    // ten-minute crash-recovery delay; this test proves recovery after expiry.
    const expired = new Date(Date.now() - 11 * 60_000); fs.utimesSync(lock, expired, expired);
    const resumed = await launch('resumed');
    assert.equal((await fetch(resumed.base + '/api/script-runs', { headers })).status, 401);
    const newHeaders = await login(resumed.base);
    const interrupted = await poll(resumed.base, run.id, newHeaders, value => value.status === 'INTERRUPTED');
    assert.equal(interrupted.successfulCount, 1);
    const retry = await fetch(`${resumed.base}/api/script-runs/${run.id}/retry`, { method: 'POST', headers: newHeaders });
    assert.equal(retry.status, 202);
    const replacement = (await retry.json()).run;
    assert.equal(replacement.requestedCount, 1);
    await poll(resumed.base, replacement.id, newHeaders, value => value.status === 'COMPLETED');
    const data = JSON.parse(fs.readFileSync(path.join(directory, 'provider.json')));
    assert.equal(Object.keys(data.scripts).length, 2);
    assert.equal(data.generations, 3, 'completed first idea must not be regenerated');
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync('data/hardening-local-restart.json', JSON.stringify({ passed: true,
      externalServices: 'mocked', savedScripts: 2, generationsIncludingAborted: 3,
      resumedCount: 1, sessionsRevoked: true, lockLease: 'expiry simulated on isolated lock' }, null, 2));
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
