import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { WeeklyScheduler } from '../src/schedules/weeklyScheduler.js';
import { JsonStateFile, recoverStateLocks } from '../src/utils/jsonStateFile.js';

const execute = promisify(execFile);
const schedule = { enabled: true, dayOfWeek: 1, time: '09:00', scriptCount: 1 };

test('state transaction failures roll back and a crashed lock owner fails closed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-rollback-'));
  try {
    const file = path.join(directory, 'state.json');
    const state = new JsonStateFile(file, { records: [] });
    state.transaction(data => data.records.push('original'));
    assert.throws(() => state.transaction(data => { data.records.push('uncommitted'); throw new Error('Failure'); }), /Failure/);
    assert.deepEqual(state.transaction(data => data.records), ['original']);
    assert.throws(() => state.transaction(() => Promise.resolve()), /synchronous/);
    const child = await execute(process.execPath, ['-e', 'console.log(process.pid)']);
    fs.writeFileSync(file + '.lock', JSON.stringify({ pid: Number(child.stdout.trim()), host: os.hostname(), token: 'dead-owner' }));
    assert.throws(() => state.transaction(data => data.records.push('unsafe')), /exited process/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).records, ['original']);
    assert.throws(() => recoverStateLocks({ files: [file] }), /Stop all server/);
    assert.deepEqual(recoverStateLocks({ files: [file], serversStopped: true }), [file + '.lock']);
    assert.deepEqual(state.transaction(data => data.records), ['original']);
    fs.writeFileSync(file + '.lock', JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'live-owner' }));
    assert.throws(() => recoverStateLocks({ files: [file], serversStopped: true }), /still alive/);
    assert.ok(fs.existsSync(file + '.lock'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('independent stores merge writes, refresh reads and preserve a live owner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-state-'));
  try {
    const filePath = path.join(directory, 'runs.json');
    const first = new RunStore({ filePath }), second = new RunStore({ filePath });
    const run = first.create({ projectId: 'one', requestedCount: 1 });
    second.create({ projectId: 'two', requestedCount: 1 });
    assert.equal(first.list().length, 2);
    assert.equal(second.get(run.id).status, 'QUEUED');
    assert.equal(new RunStore({ filePath }).get(run.id).status, 'QUEUED');
    const schedulePath = path.join(directory, 'schedules.json');
    const a = new ScheduleStore({ filePath: schedulePath }), b = new ScheduleStore({ filePath: schedulePath });
    a.set('one', schedule); b.set('two', schedule);
    assert.equal(a.listEnabled().length, 2);
    a.markRun('one', 'occurrence', 'run');
    assert.equal(b.get('one').lastRunId, 'run');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scheduler reconnects a persisted occurrence written before its schedule marker', () => {
  const runs = new RunStore();
  const schedules = new ScheduleStore({ now: () => new Date('2026-08-23T00:00:00Z') });
  schedules.set('project', schedule);
  const orphan = runs.create({ projectId: 'project', requestedCount: 1,
    source: 'SCHEDULED', scheduledFor: '2026-08-24T09:00' });
  let creates = 0;
  const scheduler = new WeeklyScheduler({ scheduleStore: schedules, timeZone: 'Asia/Singapore',
    scriptRunController: { store: runs, create: () => { creates++; } } });
  assert.equal(scheduler.tick(new Date('2026-08-24T01:00:00Z')).length, 0);
  assert.equal(creates, 0);
  assert.equal(schedules.get('project').lastRunId, orphan.id);
});

test('scheduler follows a manually resumed occurrence instead of replaying its interrupted ancestor', () => {
  const runs = new RunStore();
  const schedules = new ScheduleStore({ now: () => new Date('2026-08-23T00:00:00Z') });
  schedules.set('project', schedule);
  const original = runs.create({ projectId: 'project', requestedCount: 2, source: 'SCHEDULED', scheduledFor: '2026-08-24T09:00' });
  const resumed = runs.create({ projectId: 'project', requestedCount: 1 });
  runs.update(original.id, { status: 'INTERRUPTED', successfulCount: 1, recoveredByRunId: resumed.id });
  schedules.markRun('project', '2026-08-24T09:00', original.id);
  let creates = 0;
  const scheduler = new WeeklyScheduler({ scheduleStore: schedules, timeZone: 'Asia/Singapore',
    scriptRunController: { store: runs, create: () => { creates++; } } });
  assert.equal(scheduler.tick(new Date('2026-08-24T01:00:00Z')).length, 0);
  assert.equal(creates, 0); assert.equal(schedules.get('project').lastRunId, resumed.id);
});

test('two Node processes preserve independent writes and claim a weekly occurrence once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-processes-'));
  try {
    const filePath = path.join(directory, 'runs.json'), schedulePath = path.join(directory, 'schedules.json');
    const runModule = new URL('../src/runs/runStore.js', import.meta.url).href;
    const scheduleModule = new URL('../src/schedules/scheduleStore.js', import.meta.url).href;
    const weeklyModule = new URL('../src/schedules/weeklyScheduler.js', import.meta.url).href;
    const worker = path.join(directory, 'worker.mjs');
    new ScheduleStore({ filePath: schedulePath, now: () => new Date('2026-08-23T00:00:00Z') }).set('due', schedule);
    fs.writeFileSync(worker, `import fs from 'node:fs';
import { RunStore } from ${JSON.stringify(runModule)};
import { ScheduleStore } from ${JSON.stringify(scheduleModule)};
import { WeeklyScheduler } from ${JSON.stringify(weeklyModule)};
const runs = new RunStore({filePath:${JSON.stringify(filePath)}});
const schedules = new ScheduleStore({filePath:${JSON.stringify(schedulePath)}});
const prefix = ${JSON.stringify(directory + path.sep)};
const id = process.argv[2], other = id === 'a' ? 'b' : 'a';
const wait = async file => { for(let i=0;i<1000;i++) { if(fs.existsSync(file)) return; await new Promise(r=>setTimeout(r,10)); } throw new Error('Barrier timeout'); };
fs.writeFileSync(prefix+'ready-'+id,'1');
await wait(prefix+'ready-'+other);
for(let i=0;i<10;i++) {
 const run=runs.create({projectId:id+'-'+i,requestedCount:0});
 runs.update(run.id,{status:'COMPLETED'});
 schedules.set(id+'-'+i,{enabled:false,dayOfWeek:1,time:'09:00',scriptCount:1});
}
const scheduler=new WeeklyScheduler({scheduleStore:schedules,timeZone:'Asia/Singapore',scriptRunController:{store:runs,
 create:(input,options)=>runs.create({projectId:input.projectId,requestedCount:input.count,source:options.source,scheduledFor:input.scheduledFor})}});
const started=scheduler.tick(new Date('2026-08-24T01:00:00Z'));
fs.writeFileSync(prefix+'done-'+id,'1');
await wait(prefix+'done-'+other);
console.log(JSON.stringify({started:started.length}));`);
    const outputs = await Promise.all(['a', 'b'].map(id => execute(process.execPath, [worker, id], { timeout: 20000 })));
    assert.equal(outputs.reduce((sum, item) => sum + JSON.parse(item.stdout.trim().split('\n').at(-1)).started, 0), 1);
    const records = JSON.parse(fs.readFileSync(filePath)).runs;
    assert.equal(records.length, 21);
    assert.equal(records.filter(run => run.projectId === 'due').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(schedulePath)).schedules.length, 21);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('two standalone storyboard workers share the lock and generate once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-workers-'));
  try {
    const statePath = path.join(directory, 'provider.json');
    fs.writeFileSync(statePath, JSON.stringify({ script: { id: 'localScript',
      fields: { video_id: 'local-video', status: 'Approved' } }, generations: 0, writes: 0 }));
    const worker = path.join(directory, 'worker.mjs');
    const workerModule = new URL('../src/storyboardWorker.js', import.meta.url).href;
    fs.writeFileSync(worker, `import fs from 'node:fs';
process.env.SCRIPT_LOCK_DIR=${JSON.stringify(path.join(directory, 'locks'))};
const {processScriptStoryboard}=await import(${JSON.stringify(workerModule)});
const file=${JSON.stringify(statePath)};
const read=()=>JSON.parse(fs.readFileSync(file)),write=data=>fs.writeFileSync(file,JSON.stringify(data));
const result=await processScriptStoryboard({scriptRecord:read().script,clients:{
 gemini:{generate:async()=>{const data=read();data.generations++;write(data);await new Promise(r=>setTimeout(r,100));
 return {structure3:[{panel_prompt:'A clear science experiment.',video_prompt:'Follow the science experiment.'}]};}},
 airtable:{getScript:async()=>read().script,findStoryboardById:async()=>read().storyboard||null,
 upsertStoryboard:async fields=>{const data=read();data.writes++;data.storyboard={id:'localStoryboard',fields};write(data);return data.storyboard;},
 updateScript:async(_id,fields)=>{const data=read();Object.assign(data.script.fields,fields);write(data);}}
}});
console.log(JSON.stringify(result));`);
    await Promise.all([execute(process.execPath, [worker], { timeout: 10000 }), execute(process.execPath, [worker], { timeout: 10000 })]);
    const data = JSON.parse(fs.readFileSync(statePath));
    assert.equal(data.generations, 1); assert.equal(data.writes, 1);
    assert.equal(data.script.fields.status, 'Story Generated');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
