import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {PGlite} from '@electric-sql/pglite';
import {CloudProductionStore} from '../src/cloud/productionStore.js';
import {CloudAuditStore} from '../src/cloud/auditStore.js';
import {CloudBriefStore} from '../src/cloud/briefStore.js';
import {executeCreation,executeAudit,recoverAuditLifecycles,reconcileProduction,auditInput,auditState} from '../src/cloud/productionWork.js';
import {processScriptStoryboard} from '../src/storyboardWorker.js';
import {createApp} from '../src/app.js';
import {createRateLimiter} from '../src/http/rateLimit.js';
import {userClient,login} from './helpers/session.js';
import {ReferenceSchema,EntrySchema,acceptAnalysis} from '../src/creation/contract.js';
import {SCRIPT_SYSTEM} from '../src/agents/script/system.js';
import {REFERENCE_ANALYSIS_SYSTEM} from '../src/agents/referenceAnalysis/system.js';
import {STORYBOARD_AUDIT_SYSTEM} from '../src/agents/storyboardAudit/system.js';
import {withScriptValidation} from './helpers/scriptValidation.js';
import {storyboardReply} from './helpers/storyboard.js';
import {validAuditReport} from './helpers/storyboardAudit.js';
const project={id:'recProject',fields:{project_id:'science',niche:'Science',platform:'YouTube',status:'Active'}};
const recipe={name:'Problem to result',promise:'Show one result',opening:'Show problem',progression:['Demonstrate step'],payoff:'Reveal result',visualRules:'Readable frames',avoid:'Invented claims'};
const entry=()=>EntrySchema.parse({mode:'script',title:'Experiment',content:'Show one useful experiment.'});
let pg,db,store,audits,briefs;
before(async()=>{pg=new PGlite();const sql=await readFile(new URL('../src/cloud/schema.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(fn)};store=new CloudProductionStore(db);audits=new CloudAuditStore(db);briefs=new CloudBriefStore(db);});
after(async()=>pg?.close());
async function reset(){await pg.exec('TRUNCATE app_creation_jobs,app_blueprints,app_audits,app_audit_enrollments,app_runs,app_project_briefs,app_item_briefs');}
async function job(input=entry(),blueprint=null){const settings=await briefs.defaults('science');return store.create(project.id,randomUUID(),'SCRIPT',{entry:input,projectKey:'science',form:{niche:'Science',platform:'YouTube'},snapshot:{entry:input,blueprint,settings}},{entry:input});}
function fixture(){
 const scripts=[],boards=[];let calls=0,failStatus=false;
 const airtable={getProject:async()=>structuredClone(project),findProjectByKey:async()=>structuredClone(project),recentProjectContent:async()=>[],findScriptByVideoId:async id=>scripts.find(s=>s.fields.video_id===id)||null,getScript:async id=>structuredClone(scripts.find(s=>s.id===id)),upsertScript:async fields=>{const s={id:'recScript'+scripts.length,fields};scripts.push(s);return s;},findStoryboardById:async id=>boards.find(b=>b.fields.storyboard_id===id)||null,upsertStoryboard:async fields=>{const b={id:'recBoard'+boards.length,fields};boards.push(b);return b;},updateScript:async(id,patch)=>{if(failStatus){failStatus=false;throw Error('status write unavailable');}Object.assign(scripts.find(s=>s.id===id).fields,patch);}};
 const gemini=withScriptValidation(async({system,prompt})=>{calls++;
  if(system===SCRIPT_SYSTEM)return {scripts:[{video:{video_id:'model',title:'Experiment',estimated_duration_seconds:3,voiceover:{full_script:'This simple experiment reveals how water changes under pressure.'}},scenes:[{scene_number:1,duration_seconds:3,narration:'This simple experiment reveals how water changes under pressure.',visual:{initial_state:'Water rests',final_state:'Water moves',motion:{subject:'Water moves',environment:'Still',camera:'Still'}}}]}]};
  if(system===REFERENCE_ANALYSIS_SYSTEM)return {blueprint:recipe,observations:[{kind:'estimated',statement:'A problem to result pattern',evidence:''}]};
  if(system===STORYBOARD_AUDIT_SYSTEM)return validAuditReport(JSON.parse(prompt.split('AUDIT_INPUT_JSON:\n')[1]));
  return storyboardReply(scripts[0]);
 });
 const c={airtable,gemini,briefStore:briefs,auditStore:audits};
 return {scripts,boards,c,get calls(){return calls;},failStatus(){failStatus=true;},context:{db,productionStore:store,auditStore:audits,clients:()=>c,withSlot:fn=>fn(),withLock:(_key,fn)=>fn()}};
}
test('reference trust boundaries validate size, signature and transcript quotes',()=>{
 const png=Buffer.alloc(512000);Buffer.from('89504e470d0a1a0a','hex').copy(png);
 assert.equal(ReferenceSchema.parse({kind:'image',mimeType:'image/png',data:png.toString('base64')}).kind,'image');
 assert.throws(()=>ReferenceSchema.parse({kind:'image',mimeType:'image/jpeg',data:png.toString('base64')}));
 assert.throws(()=>ReferenceSchema.parse({kind:'image',mimeType:'image/png',data:Buffer.concat([png,Buffer.from('x')]).toString('base64')}));
 assert.throws(()=>ReferenceSchema.parse({kind:'image',mimeType:'image/png',data:'%%%'}));
 assert.throws(()=>acceptAnalysis({blueprint:recipe,observations:[{kind:'observed',statement:'Claim',evidence:'invented'}]},{kind:'transcript',text:'Original quote'}));
 assert.match(acceptAnalysis({blueprint:recipe,observations:[{kind:'observed',statement:'Claim',evidence:'Original'}]},{kind:'transcript',text:'Original quote'}).observations.at(-1).statement,/does not establish/);
});
test('durable requests conflict safely; approval and retries freeze immutable blueprint/settings',async()=>{
 await reset();const b=await store.saveBlueprint(project.id,recipe);await store.approve(project.id,b.id,'reviewer','Reviewed all limitations');
 const approved=await store.blueprint(project.id,b.id),input=EntrySchema.parse({...entry(),blueprintId:b.id});
 const one=await job(input,approved);await briefs.set('science',{structures:['structure2']});
 const two=await store.create(project.id,one.requestId,'SCRIPT',{...one.payload,form:{niche:'changed'}},{entry:input});assert.equal(two.id,one.id);assert.equal(two.payload.form.niche,'Science');
 await assert.rejects(store.create(project.id,one.requestId,'SCRIPT',one.payload,{entry:{...input,title:'different'}}),{statusCode:409});
 await store.claim('app_creation_jobs',one.id,'actor');assert.equal(await store.claim('app_creation_jobs',one.id,'other'),null);
 await assert.rejects(store.finish('app_creation_jobs',one.id,'other',{result:{}}),{statusCode:409});
 await store.finish('app_creation_jobs',one.id,'actor',{error:Error('failed')});await store.archive(project.id,b.id);
 const retry=await store.retry(project.id,one.id);assert.deepEqual(retry.payload,one.payload);assert.equal(retry.attempt,1);assert.equal(retry.workflowId,null);
 await assert.rejects(job(input,approved),{statusCode:409});
 const version=await store.saveBlueprint(project.id,{...recipe,opening:'New opening'},{parentId:b.id});assert.equal(version.version,2);assert.equal(version.status,'DRAFT');assert.equal((await store.blueprint(project.id,b.id)).approval.reviewerId,'reviewer');
});
test('direct creation shares script worker, requires manual approval and survives ambiguous persistence',async()=>{
 await reset();const f=fixture(),j=await job();let lose=true;const upsert=f.c.airtable.upsertScript;f.c.airtable.upsertScript=async fields=>{const s=await upsert(fields);if(lose){lose=false;throw Error('response lost');}return s;};
 await executeCreation(f.context,j.id,'actor');assert.equal((await store.getJob(j.id)).status,'FAILED');assert.equal(f.scripts.length,1);const calls=f.calls;
 await store.retry(project.id,j.id);await executeCreation(f.context,j.id,'retry');assert.equal((await store.getJob(j.id)).status,'COMPLETE');assert.equal(f.scripts.length,1);assert.equal(f.calls,calls);assert.equal(f.scripts[0].fields.status,'Draft');assert.equal(f.scripts[0].fields.video_id,'idea_entry_'+j.id);
 const frozen=await briefs.get('science',f.scripts[0].fields.video_id);assert.equal(frozen.entry,'script');assert.ok(frozen.guidancePacks.includes('source-adaptation@1'));
 await executeCreation(f.context,j.id,'duplicate');assert.equal(f.calls,calls);
});
test('cooldown defers rather than failing; reference replay deduplicates drafts and hides private input',async()=>{
 await reset();const f=fixture(),source={kind:'transcript',text:'PRIVATE SOURCE TEXT'},j=await store.create(project.id,randomUUID(),'ANALYZE',{source,projectKey:'science'},{source});const gen=f.c.gemini;
 f.c.gemini={generate:async()=>{throw Object.assign(Error('wait'),{code:'DEFERRED',retryAt:Date.now()+1000});}};
 assert.ok((await executeCreation(f.context,j.id,'actor')).deferredUntil);assert.equal((await store.getJob(j.id)).status,'RUNNING');f.c.gemini=gen;
 await executeCreation(f.context,j.id,'actor');const done=await store.getJob(j.id);assert.equal(done.status,'COMPLETE');const list=await store.list(project.id);assert.equal(list.jobs[0].entry,undefined);assert.ok(!JSON.stringify(list).includes('PRIVATE SOURCE TEXT'));
 const again=await store.saveBlueprint(project.id,recipe,{source:{jobId:j.id}});assert.equal(again.id,done.result.blueprintId);
});
test('storyboard recovery retains saved package and creates audit intent before completing lifecycle',async()=>{
 await reset();const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const s=f.scripts[0];s.fields.status='Approved';f.failStatus();
 await assert.rejects(processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock}),/status write/);
 assert.equal(f.boards.length,1);assert.equal(s.fields.status,'Approved');assert.ok(await audits.latest(project.id,s.id));const calls=f.calls;
 await recoverAuditLifecycles(f.context);assert.equal(s.fields.status,'Story Generated');assert.equal(f.calls,calls);assert.equal((await audits.enrollment(project.id,s.id)).lifecycleCompleted,true);
 const a=await audits.latest(project.id,s.id);await executeAudit(f.context,a.id,'auditActor');const complete=await audits.get(a.id);assert.equal(complete.status,'COMPLETE');assert.equal(complete.verdict,'PASS');
 const source={projectRecord:project,scriptRecord:s,storyboardRecord:f.boards[0],briefStore:briefs},input=await auditInput(source);assert.equal((await auditState(audits,source,input)).readiness.ready,true);
 s.fields.title='Edited source';const changed=await auditInput(source);assert.equal((await auditState(audits,source,changed)).readiness.status,'STALE');assert.deepEqual((await audits.get(a.id)).report,complete.report);
});
test('audit failure retries only the audit and keeps content; terminal dispatch is reconciled',async()=>{
 await reset();const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const s=f.scripts[0];s.fields.status='Approved';await processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock});
 const a=await audits.latest(project.id,s.id),gen=f.c.gemini;f.c.gemini={generate:async()=>{throw Error('provider unavailable');}};await executeAudit(f.context,a.id,'failedAudit');assert.equal((await audits.get(a.id)).status,'FAILED');assert.equal(f.boards.length,1);assert.equal(s.fields.status,'Story Generated');
 const input=await auditInput({projectRecord:project,scriptRecord:s,storyboardRecord:f.boards[0],briefStore:briefs});const retry=await audits.pending({enrollment:await audits.enrollment(project.id,s.id),input,retry:true});assert.notEqual(retry.id,a.id);f.c.gemini=gen;
 const dispatched=[];await audits.claim('app_audits',retry.id,'dead');await reconcileProduction(f.context,async(...args)=>dispatched.push(args),()=>({exists:Promise.resolve(true),status:Promise.resolve('failed')}));assert.deepEqual(dispatched,[['AUDIT',retry.id]]);assert.equal((await audits.get(retry.id)).workflowId,null);
 await executeAudit(f.context,retry.id,'new');assert.equal((await audits.get(retry.id)).status,'COMPLETE');assert.equal((await audits.get(a.id)).status,'FAILED');assert.equal(f.scripts.length,1);assert.equal(f.boards.length,1);
});
test('authorized routes accept bounded image bodies, persist before dispatch, scope details and reject conflicts',async()=>{
 await reset();const f=fixture(),dispatch=[];const client=userClient({...f.c.airtable,getProject:async id=>({...project,id})});
 const app=createApp({makeAirtable:()=>client,productionStore:store,auditStore:audits,briefStore:briefs,dispatchCreation:async j=>{assert.ok(await store.getJob(j.id));dispatch.push(j.id);},dispatchAudit:async()=>{},authOptions:{secureCookies:false},rateLimiter:createRateLimiter({limit:1000}),readRateLimiter:createRateLimiter({limit:1000})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{const headers={...await login(base),'Content-Type':'application/json'};const send=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});const route='/api/projects/recProject/creation-jobs';
 const png=Buffer.alloc(512000);Buffer.from('89504e470d0a1a0a','hex').copy(png);const body={requestId:randomUUID(),type:'ANALYZE',source:{kind:'image',mimeType:'image/png',data:png.toString('base64')}};
 const response=await send(route,body);assert.equal(response.status,202,await response.clone().text());const id=(await response.json()).job.id;
 assert.equal((await send(route,body)).status,202);assert.equal((await send(route,{...body,source:{...body.source,name:'Changed'}})).status,409);
 assert.equal((await fetch(base+'/api/projects/recProject2/creation-jobs/'+id,{headers})).status,404);
 const history=await(await fetch(base+'/api/projects/recProject/creation',{headers})).text();assert.ok(!history.includes(body.source.data));assert.ok(!history.includes('workflowId'));
 assert.equal((await send(route,{...body,source:{...body.source,data:'x'.repeat(810000)}})).status,413);
 assert.equal((await fetch(base+'/api/projects/recProject/creation?limit=100',{headers})).status,400);
 assert.equal(dispatch.length,2);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('inline image data reaches the provider with JSON mode unchanged',async()=>{
 const {GeminiClient}=await import('../src/clients/gemini.js');let received,options;
 const client=new GeminiClient({apiKeys:['not-live'],keyPool:{size:1,acquire:async()=>({key:'not-live',index:0})},modelFactory:args=>{options=args;return {generateContent:async value=>{received=value;return {response:{text:()=>'{"ok":true}'}};}};}});
 const media=[{inlineData:{mimeType:'image/png',data:'example'}}];assert.deepEqual(await client.generate({system:'Reference',prompt:'Analyze',json:true,media}),{ok:true});assert.deepEqual(received,[{text:'Analyze'},...media]);assert.equal(options.json,true);
});
test('new production tables are server-only and migration preserves stored jobs',async()=>{
 await reset();const j=await job();await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated');await pg.exec(await readFile(new URL('../src/cloud/schema.sql',import.meta.url),'utf8'));
 for(const table of ['app_creation_jobs','app_blueprints','app_audit_enrollments','app_audits']){
 assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE relname=$1',[table])).rows[0].relrowsecurity,true);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,'public.'+table])).rows[0].allowed,false);
 }
 assert.equal((await store.getJob(j.id)).id,j.id);
});
test('What If/topic input uses frozen formats and strict visual endpoints; project pause prevents generation',async()=>{
 await reset();const f=fixture(),j=await job(EntrySchema.parse({...entry(),mode:'topic',profile:'what-if',structures:['structure2']}));j.payload.snapshot.settings.structures=['structure2'];await store.change('app_creation_jobs',j.id,value=>{value.payload=j.payload;});await executeCreation(f.context,j.id,'whatIf');assert.equal((await store.getJob(j.id)).status,'COMPLETE');assert.equal((await briefs.get('science',f.scripts[0].fields.video_id)).structures[0],'structure2');
 const next=await job();f.c.airtable.getProject=async()=>({...project,fields:{...project.fields,status:'Paused'}});const calls=f.calls;await executeCreation(f.context,next.id,'paused');assert.equal((await store.getJob(next.id)).status,'FAILED');assert.equal(f.calls,calls);
 const {assertCreationScript}=await import('../src/creation/contract.js');assert.throws(()=>assertCreationScript({scenes:[{visual:{}}]},{creation:{profile:'what-if'}}),{code:'CREATION_VISUALS_INVALID'});
});
test('pending-intent gap recovers after auto-enrollment is disabled; completed legacy packages stay unenrolled',async()=>{
 await reset();const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const s=f.scripts[0];s.fields.status='Approved';const pending=audits.pending.bind(audits);audits.pending=async()=>{throw Error('intent unavailable');};
 try{await assert.rejects(processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock}),/intent unavailable/);}finally{audits.pending=pending;}
 assert.equal(f.boards.length,1);assert.equal(s.fields.status,'Approved');assert.equal(await audits.latest(project.id,s.id),null);
 const previous=process.env.STORYBOARD_AUDIT_AUTO_ENABLED;process.env.STORYBOARD_AUDIT_AUTO_ENABLED='false';try{
 const calls=f.calls;await recoverAuditLifecycles(f.context);assert.equal(f.calls,calls);assert.equal(s.fields.status,'Story Generated');assert.ok(await audits.latest(project.id,s.id));
 await pg.exec('TRUNCATE app_audit_enrollments,app_audits');s.fields.status='Approved';await processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock});assert.equal(await audits.enrollment(project.id,s.id),null);
 }finally{if(previous===undefined)delete process.env.STORYBOARD_AUDIT_AUTO_ENABLED;else process.env.STORYBOARD_AUDIT_AUTO_ENABLED=previous;}
});

test('save-only retry reuses successful cloud provider checkpoints; analysis versions retain provenance',async()=>{
 await reset();await pg.exec('TRUNCATE app_effects,app_leases');const {createCloudContext}=await import('../src/cloud/context.js');const f=fixture(),j=await job();let fail=true;const upsert=f.c.airtable.upsertScript;f.c.airtable.upsertScript=async fields=>{if(fail){fail=false;throw Error('write unavailable');}return upsert(fields);};
 const context=createCloudContext({db,makeGemini:()=>f.c.gemini,makeAirtable:()=>f.c.airtable,makeTelegram:()=>({})});await executeCreation(context,j.id,'first');assert.equal((await store.getJob(j.id)).errorCode,'SCRIPT_PERSIST_FAILED');const calls=f.calls;await store.retry(project.id,j.id);await executeCreation(context,j.id,'second');assert.equal((await store.getJob(j.id)).status,'COMPLETE');assert.equal(f.calls,calls);
 const b=await store.saveBlueprint(project.id,recipe,{analysis:[{kind:'unknown',statement:'Unknown motion',evidence:''}],source:{jobId:randomUUID(),name:'Source'}});const next=await store.saveBlueprint(project.id,{...recipe,opening:'New opening'},{parentId:b.id});assert.equal(next.version,2);assert.equal(next.source.derivedFromJobId,b.source.jobId);assert.equal(next.source.jobId,null);
});

test('direct factual support reaches validation; unsupported claims never persist a Script',async()=>{
 await reset();const f=fixture(),generate=f.c.gemini.generate;const narration='This simple experiment reveals how water changes under pressure.';const source={url:'https://example.com/experiment',excerpt:narration};
 f.c.gemini={generate:async args=>{const raw=await generate(args);if(raw.scene_reviews)for(const r of raw.scene_reviews)Object.assign(r,{claim_type:'factual',support_matches_claim:true,supports:[{source_url:source.url,quote:narration}]});return raw;}};
 const bad=await job();await executeCreation(f.context,bad.id,'unsupported');assert.equal((await store.getJob(bad.id)).errorCode,'SCRIPT_VALIDATION_FAILED');assert.match((await store.getJob(bad.id)).error,/factual support/);assert.equal(f.scripts.length,0);
 const good=await job(EntrySchema.parse({...entry(),factual_sources:[source]}));await executeCreation(f.context,good.id,'supported');assert.equal((await store.getJob(good.id)).status,'COMPLETE');assert.equal(f.scripts.length,1);
});
test('audit APIs keep legacy opt-in, cross-project ownership and oversized audit failure independent of content',async()=>{
 await reset();const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const script=f.scripts[0];script.fields.status='Approved';await processScriptStoryboard({scriptRecord:script,clients:f.c,auditStore:null,withLock:f.context.withLock});assert.equal(await audits.latest(project.id,script.id),null);
 const client=userClient({...f.c.airtable,getProject:async id=>id===project.id?project:{...project,id,fields:{...project.fields,project_id:'other'}}});
 const app=createApp({makeAirtable:()=>client,productionStore:store,auditStore:audits,briefStore:briefs,dispatchCreation:async()=>{},dispatchAudit:async()=>{},authOptions:{secureCookies:false},rateLimiter:createRateLimiter({limit:1000}),readRateLimiter:createRateLimiter({limit:1000})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{const headers={...await login(base),'Content-Type':'application/json'},path='/api/projects/'+project.id+'/scripts/'+script.id+'/storyboard-audit';
 const original=await(await fetch(base+path,{headers})).json();assert.equal(original.readiness.status,'UNAUDITED');assert.equal((await fetch(base+path.replace(project.id,'recProject2'),{headers})).status,404);
 const response=await fetch(base+path,{method:'POST',headers,body:'{}'});assert.equal(response.status,202);const body=await response.json();assert.equal(body.audit.status,'PENDING');assert.equal(body.audit.workflowId,undefined);
 const board=f.boards[0],raw=JSON.parse(board.fields.storyboard_text);raw.master_assets.large='x'.repeat(181000);board.fields.storyboard_text=JSON.stringify(raw);const changed=await auditInput({projectRecord:project,scriptRecord:script,storyboardRecord:board,briefStore:briefs});
 const a=await audits.pending({enrollment:await audits.enrollment(project.id,script.id),input:changed});const calls=f.calls;await executeAudit(f.context,a.id,'oversized');assert.equal((await audits.get(a.id)).errorCode,'AUDIT_INPUT_TOO_LARGE');assert.equal(f.calls,calls);assert.equal(script.fields.status,'Story Generated');assert.equal(f.boards.length,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('storyboard save hands the persisted audit to dispatch before Script completion, even with an older maintenance owner',async()=>{
 await reset();await db.query("INSERT INTO app_maintenance(id,owner,updated_at) VALUES('main','older-live-owner',now()) ON CONFLICT(id) DO UPDATE SET owner=EXCLUDED.owner,updated_at=now()");
 const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const s=f.scripts[0];s.fields.status='Approved';const dispatched=[];
 await processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock,onAuditPending:async audit=>{assert.equal(s.fields.status,'Approved');assert.equal(f.boards.length,1);assert.equal((await audits.get(audit.id)).status,'PENDING');dispatched.push(audit.id);}});
 assert.deepEqual(dispatched,[(await audits.latest(project.id,s.id)).id]);assert.equal(s.fields.status,'Story Generated');
});
test('failed immediate audit dispatch retains saved content and cron reconciles without relying on maintenance ownership',async()=>{
 await reset();const {CloudState}=await import('../src/cloud/state.js');const {cloudControllers}=await import('../src/cloud/controllers.js');const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const s=f.scripts[0];s.fields.status='Approved';
 await processScriptStoryboard({scriptRecord:s,clients:f.c,withLock:f.context.withLock,onAuditPending:async()=>{throw Error('queue unavailable');}});
 assert.equal(s.fields.status,'Story Generated');const a=await audits.latest(project.id,s.id);assert.equal(a.status,'PENDING');const starts=[];
 await cloudControllers(new CloudState(db),async(fn,args)=>{starts.push(args);return {runId:'new'};},{productionContext:f.context,inspectWorkflow:()=>({exists:true,status:'running'})}).reconcile();
 assert.ok(starts.some(args=>args[0]==='AUDIT'&&args[1]===a.id));assert.equal(f.boards.length,1);assert.equal(f.scripts.length,1);
});


test('production export and editorial review enforce ownership, immutable report identity and current sources',async()=>{
 await reset();const f=fixture(),j=await job();await executeCreation(f.context,j.id,'actor');const script=f.scripts[0];script.fields.status='Approved';await processScriptStoryboard({scriptRecord:script,clients:f.c,withLock:f.context.withLock});
 const a=await audits.latest(project.id,script.id);await executeAudit(f.context,a.id,'audit');
 let paused=false,mutateOnRead=false,reads=0;
 const client=userClient({...f.c.airtable,getProject:async()=>({...project,fields:{...project.fields,status:paused?'Paused':'Active'}}),findStoryboardById:async id=>{const value=structuredClone(await f.c.airtable.findStoryboardById(id));if(mutateOnRead&&++reads===2)value.fields.thumbnail_prompt='Concurrent external change';return value;}});
 const app=createApp({makeAirtable:()=>client,productionStore:store,auditStore:audits,briefStore:briefs,dispatchCreation:async()=>{},dispatchAudit:async()=>{},authOptions:{secureCookies:false},rateLimiter:createRateLimiter({limit:1000}),readRateLimiter:createRateLimiter({limit:1000})});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  const headers={...await login(base),'Content-Type':'application/json'},route='/api/projects/'+project.id+'/scripts/'+script.id;
  const get=path=>fetch(base+(path||route+'/production-export'),{headers});
  const review=body=>fetch(base+route+'/storyboard-audit/review',{method:'POST',headers,body:JSON.stringify(body)});
  const reason='Reviewed editorial limitations and accept this production plan.';
  const calls=f.calls,original=(await audits.get(a.id)).report;
  assert.equal((await fetch(base+route+'/production-export')).status,401);
  assert.equal((await get()).status,200);
  assert.equal((await get('/api/projects/other/scripts/'+script.id+'/production-export')).status,404);
  mutateOnRead=true;reads=0;assert.equal((await get()).status,409);mutateOnRead=false;
  await audits.change('app_audits',a.id,value=>{value.verdict='NEEDS_REVIEW';value.report.verdict='NEEDS_REVIEW';});
  const editorial=(await audits.get(a.id)).report;
  assert.equal((await get()).status,409);
  assert.equal((await review({reason})).status,400);
  assert.equal((await review({auditId:randomUUID(),reason})).status,409);
  paused=true;assert.equal((await review({auditId:a.id,reason})).status,409);paused=false;
  assert.equal((await review({auditId:a.id,reason})).status,200);
  assert.equal((await review({auditId:a.id,reason})).status,200);
  assert.equal((await review({auditId:a.id,reason:'A different review must not overwrite history.'})).status,409);
  const saved=await audits.get(a.id);assert.deepEqual(saved.report,editorial);assert.equal(saved.verdict,'NEEDS_REVIEW');assert.ok(saved.acknowledgement.reviewerId);assert.equal(saved.acknowledgement.auditId,a.id);
  paused=true;const exported=await get();assert.equal(exported.status,200);assert.deepEqual((await exported.json()).storyboard,f.boards[0]);paused=false;
  await audits.change('app_audits',a.id,value=>{value.report.issues=[{severity:'blocking'}];});assert.equal((await get()).status,409);assert.equal((await review({auditId:a.id,reason})).status,409);
  await audits.change('app_audits',a.id,value=>{value.report=editorial;});
  script.fields.title='Externally changed Script';assert.equal((await get()).status,409);assert.equal((await review({auditId:a.id,reason})).status,409);script.fields.title='Experiment';
  await audits.change('app_audits',a.id,value=>{value.fingerprint='old rubric';});assert.equal((await get()).status,409);
  await pg.query('DELETE FROM app_audits WHERE id=$1',[a.id]);assert.equal((await get()).status,409);
  assert.equal(f.calls,calls);assert.equal(original.verdict,'PASS');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
