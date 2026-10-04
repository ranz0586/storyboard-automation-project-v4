import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { once } from 'node:events';
import { AirtableClient } from '../src/clients/airtable.js';
import { RunStore } from '../src/runs/runStore.js';
import { ScheduleStore } from '../src/schedules/scheduleStore.js';
import { createApp } from '../src/app.js';
import { userClient, login } from '../tests/helpers/session.js';

// Synthetic provider pages, real statistics/store/HTTP/auth code. No external
// service requests, production state files, schedules or generation are used.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-benchmark-'));
const result = { checkedAt: new Date().toISOString(), externalServices: 'mocked',
  ownedProjects: 1000, ideasPerProject: 1000, scriptsPerProject: 500,
  statsPages: 0, statsRows: 0, peakPageRows: 0, peakHeapMb: 0, peakRssMb: 0, accountReads: 0 };
const accountReadDelayMs = 20;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sample = () => { const memory = process.memoryUsage();
  result.peakHeapMb = Math.max(result.peakHeapMb, memory.heapUsed / 1048576);
  result.peakRssMb = Math.max(result.peakRssMb, memory.rss / 1048576); };
const ids = Array.from({ length: result.ownedProjects }, (_, index) => `recBench${String(index).padStart(4, '0')}`);
const provider = new AirtableClient({ apiKey: 'benchmark-only', base: table => ({
  select: options => ({
    firstPage: async () => ids.filter(id => options.filterByFormula.includes(`"${id}"`))
      .map(id => ({ id, fields: { project_id: `project_${id.slice(-4)}` } })),
    eachPage: (visit, done) => {
      const keys = [...new Set(options.filterByFormula.match(/project_\d+/g) || [])];
      const count = table === 'Ideas' ? result.ideasPerProject : result.scriptsPerProject;
      let offset = 0;
      const next = () => {
        if (offset >= keys.length * count) { done(); return; }
        const rows = Array.from({ length: Math.min(100, keys.length * count - offset) }, (_, index) => {
          const ordinal = offset + index, position = ordinal % count;
          return { id: `mock${ordinal}`, fields: { Projects: keys[Math.floor(ordinal / count)],
            ...(table === 'Ideas' ? { 'Idea Status': position % 2 ? 'Script Generated' : 'Draft' }
              : { status: position < 100 ? 'Approved' : position < 300 ? 'Story Generated' : 'Draft' }) } };
        });
        offset += rows.length; result.statsPages++; result.statsRows += rows.length;
        result.peakPageRows = Math.max(result.peakPageRows, rows.length); sample();
        visit(rows, () => queueMicrotask(next));
      };
      next();
    },
  }),
}) });
const runs = new RunStore({ filePath: path.join(directory, 'runs.json') });
const seedStart = performance.now();
runs.transaction(() => {
  for (let index = 0; index < 200; index++) {
    const run = runs.create({ projectId: ids[0], requestedCount: 50 });
    for (let item = 0; item < 50; item++) runs.addItem(run.id, { ideaId: `idea${item}`, status: 'FAILED', error: 'x'.repeat(1000) });
    runs.update(run.id, { status: 'FAILED', processedCount: 50, failedCount: 50 });
  }
});
result.seedMs = performance.now() - seedStart;
result.runStateBytes = fs.statSync(path.join(directory, 'runs.json')).size;
const account = userClient({}, ids);
const client = userClient({
  getUser: async () => { result.accountReads++; await delay(accountReadDelayMs); return account.getUser(); },
  listProjectsPageForUser: provider.listProjectsPageForUser.bind(provider),
  projectStats: provider.projectStats.bind(provider),
}, ids);
const app = createApp({ makeAirtable: () => client, makeGemini: () => ({}), makeTelegram: () => ({}),
  runStore: runs, scheduleStore: new ScheduleStore(), authOptions: { secureCookies: false } });
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const base = `http://127.0.0.1:${server.address().port}`, headers = await login(base);
  const start = performance.now();
  const projects = await (await fetch(base + '/api/projects?limit=50', { headers })).json();
  result.projectReadMs = performance.now() - start;
  result.returnedProjects = projects.projects.length;
  result.sampleStats = projects.projects[0].stats;
  const timings = [];
  for (let index = 0; index < 20; index++) {
    const before = performance.now();
    const response = await fetch(base + `/api/script-runs?projectId=${ids[0]}&limit=20`, { headers });
    if (response.status !== 200) throw new Error('History poll failed');
    const history = await response.json();
    if (history.runs.length !== 20) throw new Error('History page was not bounded');
    timings.push(performance.now() - before); sample();
  }
  timings.sort((a, b) => a - b);
  result.historyP95Ms = timings[Math.floor(timings.length * 0.95)];
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const concurrentTimings = [];
  result.concurrentTabs = 4;
  result.concurrentWaves = 5;
  result.simulatedAccountReadDelayMs = accountReadDelayMs;
  for (let wave = 0; wave < result.concurrentWaves; wave++) {
    await Promise.all(Array.from({ length: result.concurrentTabs }, async () => {
      const before = performance.now();
      const response = await fetch(base + `/api/script-runs?projectId=${ids[0]}&limit=20`, { headers });
      if (response.status !== 200) throw new Error(`Concurrent history poll failed (${response.status})`);
      const history = await response.json();
      if (history.runs.length !== 20) throw new Error('Concurrent history page was not bounded');
      concurrentTimings.push(performance.now() - before); sample();
    }));
    await delay(10);
  }
  loop.disable();
  concurrentTimings.sort((a, b) => a - b);
  result.concurrentPolls = concurrentTimings.length;
  result.concurrentHistoryP95Ms = concurrentTimings[Math.floor(concurrentTimings.length * 0.95)];
  result.eventLoopP95Ms = loop.percentile(95) / 1e6;
  result.eventLoopMaxMs = loop.max / 1e6;
  result.passed = result.returnedProjects === 50 && result.peakPageRows <= 100 &&
    result.sampleStats.ideas === 1000 && result.sampleStats.scripts === 500 && result.peakRssMb < 500;
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/hardening-benchmark.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
