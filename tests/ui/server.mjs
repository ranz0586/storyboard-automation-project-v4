// Browser tests use the real Express routes, auth, run controllers, agents,
// transforms, worker, scheduler and recovery. Only external services are fake.
import { createApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { RunStore } from '../../src/runs/runStore.js';
import { ScheduleStore } from '../../src/schedules/scheduleStore.js';
import { createRateLimiter } from '../../src/http/rateLimit.js';
import { WeeklyScheduler } from '../../src/schedules/weeklyScheduler.js';
import { runStoryboardPipeline } from '../../src/storyboardPipeline.js';
import { runIdeaRecovery } from '../../src/ideaRecoveryPipeline.js';
import { RESEARCH_SYSTEM } from '../../src/agents/research/system.js';
import { IDEA_SYSTEM } from '../../src/agents/idea/system.js';
import { SCRIPT_SYSTEM } from '../../src/agents/script/system.js';
import { STORYBOARD_SYSTEM } from '../../src/agents/storyboard/system.js';
import { SCRIPT_VALIDATION_SYSTEM } from '../../src/agents/scriptValidation/system.js';
import { scriptFromValidationPrompt, validationReply } from '../helpers/scriptValidation.js';

config.ytdlp.enabled = false;
config.locks.scriptDir = 'data/ui-test-locks';
const projects = [], users = [], ideas = [], scripts = [], storyboards = [], alerts = [];
let failScript = false, sequence = 0;
const copy = value => structuredClone(value);
const byId = (rows, id) => {
  const record = rows.find(row => row.id === id);
  if (!record) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  return record;
};
const eligible = key => ideas.filter(idea => idea.fields.Projects === key && idea.fields['Idea Status'] === 'Draft');
const client = {
  findUserByUsername: async name => copy(users.find(user => user.fields.username === name) || null),
  createUser: async fields => { const record = { id: `recUser${users.length + 1}`, fields }; users.push(record); return copy(record); },
  getUser: async id => copy(byId(users, id)),
  createProject: async fields => {
    const existing = projects.find(project => project.fields.project_id === fields.project_id);
    if (existing) return { ...copy(existing), updated: true };
    const record = { id: `recProject${projects.length + 1}`, fields: { ...fields, status: 'Active' } };
    projects.push(record);
    const account = byId(users, fields.Users[0]);
    account.fields.Projects = [...(account.fields.Projects || []), record.id];
    return copy(record);
  },
  listProjectsForUser: async user => copy(projects.filter(project => user.projectIds.includes(project.id))),
  listProjectsPageForUser: async (user, { limit, offset }) => {
    const ids = [...user.projectIds].sort(), start = offset ? ids.indexOf(offset) + 1 : 0;
    const page = ids.slice(start, start + limit);
    return { projects: copy(page.map(id => byId(projects, id))), nextOffset: start + limit < ids.length ? page.at(-1) : null };
  },
  getProject: async id => copy(byId(projects, id)),
  findProjectByKey: async key => copy(projects.find(project => project.fields.project_id === key)),
  updateProjectStatus: async (id, status) => { const record = byId(projects, id); record.fields.status = status; return copy(record); },
  projectStats: async keys => Object.fromEntries(keys.map(key => [key, {
    ideas: ideas.filter(idea => idea.fields.Projects === key).length,
    scripts: scripts.filter(script => script.fields.Projects === key).length,
    approvedScripts: scripts.filter(script => script.fields.Projects === key && script.fields.status === 'Approved').length,
    storyboards: storyboards.filter(story => scripts.some(script => script.fields.video_id === story.fields.storyboard_id && script.fields.Projects === key)).length,
    failedRecoveryItems: eligible(key).length,
  }])),
  upsertIdea: async fields => {
    let record = ideas.find(idea => idea.fields.title === fields.title && idea.fields.Projects === fields.Projects);
    if (!record) { record = { id: `recIdea${ideas.length + 1}`, fields }; ideas.push(record); }
    else Object.assign(record.fields, fields);
    return copy(record);
  },
  listIdeasForProject: async id => copy(eligible(byId(projects, id).fields.project_id)),
  listIdeasPageForProject: async (id, { limit, offset }) => {
    const rows = eligible(byId(projects, id).fields.project_id), start = Number(offset || 0);
    return { ideas: copy(rows.slice(start, start + limit)), nextOffset: start + limit < rows.length ? String(start + limit) : null };
  },
  forEachEligibleIdea: async (id, { limit }, visit) => { const rows = copy(eligible(byId(projects, id).fields.project_id).slice(0, limit)); for (const row of rows) await visit(row); return rows.length; },
  forEachStuckIdea: async (filter, { limit }, visit) => { const rows = copy(ideas.filter(idea => idea.fields['Idea Status'] === 'Draft' && filter.includes(idea.fields.Projects)).slice(0, limit)); for (const row of rows) await visit(row); },
  getIdea: async id => copy(byId(ideas, id)),
  updateIdea: async (id, fields) => { Object.assign(byId(ideas, id).fields, fields); },
  findScriptByVideoId: async videoId => copy(scripts.find(script => script.fields.video_id === videoId) || null),
  upsertScript: async fields => {
    let record = scripts.find(script => script.fields.video_id === fields.video_id);
    if (!record) { record = { id: `recScript${scripts.length + 1}`, fields }; scripts.push(record); }
    else Object.assign(record.fields, fields);
    return copy(record);
  },
  getScript: async id => copy(byId(scripts, id)),
  updateScript: async (id, fields) => { const record = byId(scripts, id); Object.assign(record.fields, fields); return copy(record); },
  listScriptsForProject: async (id, { offset }) => {
    const rows = scripts.filter(script => script.fields.Projects === byId(projects, id).fields.project_id);
    // Two rows per fixture page makes cursor navigation observable.
    const start = Number(offset || 0);
    return { scripts: copy(rows.slice(start, start + 2)), nextOffset: start + 2 < rows.length ? String(start + 2) : null };
  },
  searchScripts: async filter => copy(scripts.filter(script => script.fields.status === 'Approved' && filter.includes(script.fields.Projects))),
  findStoryboardById: async id => copy(storyboards.find(row => row.fields.storyboard_id === id) || null),
  upsertStoryboard: async fields => { const record = { id: `recStoryboard${storyboards.length + 1}`, fields }; storyboards.push(record); return copy(record); },
};
const gemini = { generate: async ({ system, prompt }) => {
  await new Promise(resolve => setTimeout(resolve, 100));
  if (system === RESEARCH_SYSTEM) return { report: 'Test research' };
  if (system === IDEA_SYSTEM) return { concepts: Array.from({ length: Number(prompt.match(/- (\d+) content concepts/)[1]) }, () => ({ title: `Science idea ${++sequence}`, topic: 'Science', emotional_angle: 'Curiosity', content_score: 90 })) };
  if (system === SCRIPT_SYSTEM) {
    if (failScript) { failScript = false; throw new Error('Simulated provider outage'); }
    const concept = JSON.parse(prompt.split('CONCEPT TO PROCESS:\n')[1].split('\n')[0]);
    return { scripts: [{ video: { video_id: 'model-id', title: `Script ${concept.title}`, estimated_duration_seconds: 30, voiceover: { full_script: `Narration for ${concept.title}` } }, scenes: [{ scene_number: 1, duration_seconds: 30, narration: concept.title }] }] };
  }
  if (system === STORYBOARD_SYSTEM) return { master_assets: {}, structure3: [{ panel_number: 1, scene_number: 1,
    panel_prompt: 'A cinematic science experiment panel.', video_prompt: 'Track the experiment as water moves.' }] };
  if (system === SCRIPT_VALIDATION_SYSTEM) return validationReply(scriptFromValidationPrompt(prompt));
  throw new Error('Unexpected agent');
} };
const telegram = { errorAlert: async value => { alerts.push({ type: 'error', value }); }, scriptsGeneratedAlert: async value => { alerts.push({ type: 'success', value }); } };
const store = new RunStore(), schedules = new ScheduleStore();
const app = createApp({ authOptions: { secureCookies: false, lockDir: 'data/ui-test-user-locks' },
  makeAirtable: () => client, makeGemini: () => gemini, makeTelegram: () => telegram,
  runStore: store, scheduleStore: schedules,
  rateLimiter: createRateLimiter({ limit: 1000 }), readRateLimiter: createRateLimiter({ limit: 10000 }),
});
const clients = { airtable: client, gemini, telegram };
// Test-only operator hooks never imported by the production server.
app.post('/__test/fail-script', (_req, res) => { failScript = true; res.json({ ok: true }); });
app.post('/__test/seed-pagination', (req, res) => {
  const account = users.find(user => user.fields.username === req.body.username);
  for (let i = 1; i <= 51; i++) {
    const record = { id: `recPage${account.id}${String(i).padStart(3, '0')}`,
      fields: { project_id: `page_${account.id}_${i}`, channel_page_name: `Paged project ${i}`,
        niche: 'Science', platform: 'YouTube', status: 'Active' } };
    projects.push(record);
    account.fields.Projects = [...(account.fields.Projects || []), record.id];
    if (i === 51) for (let j = 1; j <= 51; j++) ideas.push({
      id: `recPagedIdea${account.id}${j}`, fields: { title: `Paged idea ${String(j).padStart(3, '0')}`,
        niche: 'Science', platform: 'YouTube', Projects: record.fields.project_id, 'Idea Status': 'Draft' } });
  }
  res.json({ ok: true });
});
app.post('/__test/interrupted/:projectId', (req, res) => {
  const key = byId(projects, req.params.projectId).fields.project_id;
  const rows = ideas.filter(idea => idea.fields.Projects === key);
  const partial = req.body.phase !== 'before';
  const run = store.create({ projectId: req.params.projectId, requestedCount: rows.length,
    selectedIdeaIds: rows.map(idea => idea.id) });
  if (partial) store.addItem(run.id, { ideaId: rows[0].id, status: 'SUCCEEDED' });
  res.json({ run: store.update(run.id, { status: 'INTERRUPTED',
    error: 'Server restarted before this run completed',
    successfulCount: partial ? 1 : 0, processedCount: partial ? 1 : 0,
    interruptedItem: req.body.phase === 'mid' ? rows[1].id : null }) });
});
app.post('/__test/scheduler', (_req, res) => {
  const scheduler = new WeeklyScheduler({ scheduleStore: schedules, scriptRunController: app.locals.scriptRunController, timeZone: 'Asia/Singapore' });
  res.json({ runs: scheduler.tick(new Date(Date.now() + 15 * 24 * 60 * 60_000)) });
});
app.post('/__test/storyboard/:projectId', async (req, res) => res.json(await runStoryboardPipeline({ clients, runStore: store, projectKeyFilter: byId(projects, req.params.projectId).fields.project_id })));
app.post('/__test/recovery/:projectId', async (req, res) => res.json(await runIdeaRecovery({ clients, runStore: store, limit: 1, projectKeyFilter: byId(projects, req.params.projectId).fields.project_id })));
app.get('/__test/state', (_req, res) => res.json({ projects, ideas, scripts, storyboards, alerts, runs: store.list(), schedules: schedules.listEnabled() }));
app.listen(3107, '127.0.0.1', () => console.log('UI fixture listening on 3107 (external services mocked)'));
