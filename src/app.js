import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getField } from './utils/field.js';
import { assertProjectActive, belongsToProject } from './utils/project.js';
import { isUsableScriptRecord } from './scriptWorker.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { createUserAuth, requireSameOriginWrite } from './http/auth.js';
import { createRateLimiter } from './http/rateLimit.js';
import { TaskQueue } from './http/taskQueue.js';
import {
  ProjectCreateSchema,
  ScriptRunRequestSchema,
  WeeklyScheduleSchema,
  IdeaRunRequestSchema,
  ProjectStatusSchema,
  ScriptPageSchema,
  CollectionPageSchema,
  validateBody,
} from './http/validation.js';
import { RunStore } from './runs/runStore.js';
import { ScriptRunController } from './runs/scriptRunController.js';
import { ScheduleStore } from './schedules/scheduleStore.js';
import { IdeaRunController } from './runs/ideaRunController.js';

export function createApp({
  authOptions = {},
  makeGemini = gemini,
  makeAirtable = airtable,
  makeTelegram = telegram,
  rateLimiter = createRateLimiter({
    limit: config.server.rateLimitMax,
    windowMs: config.server.rateLimitWindowMs,
  }),
  readRateLimiter = createRateLimiter({
    limit: config.server.readRateLimitMax,
    windowMs: config.server.rateLimitWindowMs,
  }),
  pipelineQueue,
  runStore,
  scriptRunController,
  scheduleStore,
  ideaRunController,
  onScriptApproved,
} = {}) {
  const app = express();
  const asyncRoute = handler => (req,res,next) => Promise.resolve(handler(req,res,next)).catch(next);
  const queue = pipelineQueue || new TaskQueue({
    maxConcurrency: config.server.maxConcurrentPipelines,
    maxQueued: config.server.maxQueuedPipelines,
    onError: (err) => logger.error('Pipeline failed', err?.message),
  });
  const store = runStore || new RunStore({ filePath: config.scheduler.runStatePath });
  const runs = scriptRunController || new ScriptRunController({
    store,
    queue,
    makeGemini,
    makeAirtable,
    makeTelegram,
  });
  const schedules = scheduleStore || new ScheduleStore({ filePath: config.scheduler.statePath });
  const ideaRuns = ideaRunController || new IdeaRunController({
    store,
    queue,
    makeGemini,
    makeAirtable,
  });
  app.locals.runStore = store;
  app.locals.pipelineQueue = queue;
  app.locals.scriptRunController = runs;
  app.locals.scheduleStore = schedules;
  app.locals.ideaRunController = ideaRuns;

  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const userAuth = createUserAuth({ ...authOptions, makeAirtable, sessionRateLimiter: readRateLimiter });
  userAuth.mount(app);
  const authenticate = userAuth.authenticate;
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Reject requests before authentication spends an Airtable Users read.
  // Route handlers must not charge the same limiter a second time.
  app.use('/api', userAuth.requireSession, requireSameOriginWrite, (req, res, next) =>
    (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? readRateLimiter : rateLimiter)(req, res, next), authenticate);
  const ownsProject = (req, id) => typeof id === 'string' && req.user.projectIds.includes(id);
  // Guard every project route before a handler can read or modify its records.
  app.use('/api/projects/:id', (req, res, next) => {
    if (!ownsProject(req, req.params.id)) return res.status(404).json({ error: 'Project not found' });
    next();
  });
  app.use('/api/script-runs', (req, res, next) => {
    const id = req.body?.projectId || req.query.projectId;
    if (id !== undefined && !ownsProject(req, id)) return res.status(404).json({ error: 'Project not found' });
    next();
  });
  app.use('/api/script-runs/:id', asyncRoute(async (req, res, next) => {
    const run = await store.get(req.params.id);
    if (!run || !ownsProject(req, run.projectId)) return res.status(404).json({ error: 'Pipeline run not found' });
    next();
  }));
  const projectError = (res, err, fallback) => {
    if (err?.statusCode === 404 || err?.status === 404) return res.status(404).json({ error: 'Record not found' });
    if (err?.statusCode === 409) return res.status(409).json({ error: err.message });
    logger.error(fallback, err?.message);
    return res.status(503).json({ error: fallback });
  };

  app.get('/api/projects', async (req, res) => {
    const query = CollectionPageSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Invalid project page' });
    try {
      const client = makeAirtable();
      const page = typeof client.listProjectsPageForUser === 'function'
        ? await client.listProjectsPageForUser(req.user, query.data)
        : { projects: await client.listProjectsForUser(req.user, query.data.limit), nextOffset: null };
      const projects = page.projects;
      const stats = await client.projectStats(projects.map((project) => getField(project.fields, 'project_id')));
      return res.json({
        projects: projects.map((project) => ({ ...project, stats: stats[getField(project.fields, 'project_id')] })),
        nextOffset: page.nextOffset,
      });
    } catch (err) {
      logger.error('List projects failed', err?.message);
      return res.status(err.statusCode === 400 ? 400 : 503).json({ error: err.statusCode === 400 ? 'Invalid project page cursor' : 'Projects are temporarily unavailable' });
    }
  });

  app.post(
    '/api/projects',
    validateBody(ProjectCreateSchema),
    async (req, res) => {
      const input = req.validatedBody;
      try {
        const project = await makeAirtable().createProject({
          project_id: `dashboard_${req.user.id}_${input.requestId}`,
          Users: [req.user.id],
          channel_page_name: input.name,
          niche: input.niche,
          platform: input.platform,
          target_audience: input.targetAudience,
          content_style: input.contentStyle,
          description: input.description,
          has_character_reference: input.hasCharacterReference,
          has_style_reference: input.hasStyleReference,
        });
        return res.status(project.updated ? 200 : 201).json({ project });
      } catch (err) {
        logger.error('Create project failed', err?.message);
        return res.status(503).json({ error: 'Project could not be created' });
      }
    }
  );

  app.get('/api/projects/:id', async (req, res) => {
    try {
      const client = makeAirtable();
      const project = await client.getProject(req.params.id);
      const stats = await client.projectStats([project.fields.project_id]);
      return res.json({ project: { ...project, stats: stats[project.fields.project_id] } });
    } catch (err) {
      if (err?.statusCode === 404 || err?.status === 404) {
        return res.status(404).json({ error: 'Project not found' });
      }
      logger.error('Get project failed', err?.message);
      return res.status(503).json({ error: 'Project is temporarily unavailable' });
    }
  });

  app.patch('/api/projects/:id/status', validateBody(ProjectStatusSchema), async (req, res) => {
    try {
      const client = makeAirtable();
      await client.getProject(req.params.id);
      // Disable recurrence before pausing. A failed status write leaves the
      // schedule safely disabled; the caller receives an explicit error.
      const existing = await schedules.get(req.params.id);
      if (req.validatedBody.status !== 'Active' && existing?.enabled) {
        await schedules.set(req.params.id, { ...existing, enabled: false });
      }
      const project = await client.updateProjectStatus(req.params.id, req.validatedBody.status);
      return res.json({ project, schedule: await schedules.get(req.params.id) });
    } catch (err) {
      return projectError(res, err, 'Project status could not be updated; refresh the project and schedule');
    }
  });

  app.get('/api/projects/:id/scripts', async (req, res) => {
    const parsed = ScriptPageSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid script page request' });
    try {
      return res.json(await makeAirtable().listScriptsForProject(req.params.id, parsed.data));
    } catch (err) {
      return projectError(res, err, 'Scripts are temporarily unavailable');
    }
  });

  app.post('/api/projects/:id/scripts/:scriptId/approve', async (req, res) => {
    try {
      const client = makeAirtable();
      const project = await client.getProject(req.params.id);
      const script = await client.getScript(req.params.scriptId);
      if (!belongsToProject(script, project)) return res.status(404).json({ error: 'Script not found in this project' });
      // Retried approvals must never turn a completed storyboard back into work.
      if (['Approved', 'Story Generated'].includes(script.fields.status)) {
        if (script.fields.status === 'Approved') await onScriptApproved?.({script,project});
        return res.json({ script });
      }
      assertProjectActive(project);
      if (script.fields.status !== 'Draft' || !isUsableScriptRecord(script)) {
        return res.status(409).json({ error: 'Only a complete Draft script can be approved' });
      }
      const updated = await client.updateScript(script.id, { status: 'Approved' });
      await onScriptApproved?.({script:updated,project});
      return res.json({ script: updated });
    } catch (err) {
      if (err?.statusCode === 422 && err?.error === 'INVALID_MULTIPLE_CHOICE_OPTIONS') {
        return res.status(409).json({ error: 'Airtable Scripts.status needs an Approved choice before scripts can be approved' });
      }
      return projectError(res, err, 'Script approval could not be saved');
    }
  });

  app.get('/api/projects/:id/ideas', async (req, res) => {
    const query = CollectionPageSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: 'Invalid idea page' });
    try {
      const client = makeAirtable();
      const page = typeof client.listIdeasPageForProject === 'function'
        ? await client.listIdeasPageForProject(req.params.id, query.data)
        : { ideas: await client.listIdeasForProject(req.params.id, query.data.limit), nextOffset: null };
      return res.json(page);
    } catch (err) {
      logger.error('List project ideas failed', err?.message);
      return res.status(503).json({ error: 'Ideas are temporarily unavailable' });
    }
  });

  app.post(
    '/api/projects/:id/idea-runs',
    validateBody(IdeaRunRequestSchema),
    async (req, res) => {
      try {
        assertProjectActive(await makeAirtable().getProject(req.params.id));
        const run = await ideaRuns.create({ projectId: req.params.id, count: req.validatedBody.count });
        if (!run) return res.status(503).json({ error: 'Pipeline queue is full' });
        return res.status(202).json({ run });
      } catch (err) { return projectError(res, err, 'Idea run could not be started'); }
    }
  );

  app.post(
    '/api/script-runs',
    validateBody(ScriptRunRequestSchema),
    async (req, res) => {
      try {
        assertProjectActive(await makeAirtable().getProject(req.validatedBody.projectId));
        const run = await runs.create(req.validatedBody);
        if (!run) return res.status(503).json({ error: 'Pipeline queue is full' });
        return res.status(202).json({ run });
      } catch (err) { return projectError(res, err, 'Script run could not be started'); }
    }
  );

  app.get('/api/script-runs', asyncRoute(async (req, res) => {
    return res.json({ runs: await store.list({ projectId: req.query.projectId, projectIds: req.user.projectIds, limit: req.query.limit }) });
  }));

  app.get('/api/script-runs/:id', asyncRoute(async (req, res) => {
    const run = await store.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Pipeline run not found' });
    return res.json({ run });
  }));

  app.post('/api/script-runs/:id/retry', asyncRoute(async (req, res) => {
    const prior = await store.get(req.params.id);
    if (!prior) return res.status(404).json({ error: 'Pipeline run not found' });
    try { assertProjectActive(await makeAirtable().getProject(prior.projectId)); }
    catch (err) { return projectError(res, err, 'Retry could not be started'); }
    const result = await runs.retry(req.params.id);
    if (result?.error === 'NOT_FOUND') return res.status(404).json({ error: 'Pipeline run not found' });
    if (result?.error === 'NO_FAILED_ITEMS') {
      return res.status(409).json({ error: 'Pipeline run has no failed ideas to retry' });
    }
    if (!result) return res.status(503).json({ error: 'Pipeline queue is full' });
    return res.status(202).json({ run: result });
  }));

  app.get('/api/projects/:id/schedule', asyncRoute(async (req, res) => {
    return res.json({ schedule: await schedules.get(req.params.id) });
  }));

  app.put(
    '/api/projects/:id/schedule',
    validateBody(WeeklyScheduleSchema),
    async (req, res) => {
      try {
        const project = await makeAirtable().getProject(req.params.id);
        if (req.validatedBody.enabled) assertProjectActive(project);
        const schedule = await schedules.set(req.params.id, req.validatedBody);
        return res.json({ schedule });
      } catch (err) {
        if (err?.statusCode === 409) return res.status(409).json({ error: err.message });
        if (err?.statusCode === 404 || err?.status === 404) {
          return res.status(404).json({ error: 'Project not found' });
        }
        logger.error('Update schedule failed', err?.message);
        return res.status(503).json({ error: 'Schedule could not be updated' });
      }
    }
  );

  // Implicit niche matching can cross account boundaries. Generation now
  // starts from an explicitly authorized project in the dashboard.
  app.post('/niche', userAuth.requireSession, requireSameOriginWrite, rateLimiter, authenticate, (_req, res) => {
    res.status(410).json({ error: 'Use project idea runs and script runs in the dashboard' });
  });

  app.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    res.status(503).json({error:'Service is temporarily unavailable'});
  });
  return app;
}
