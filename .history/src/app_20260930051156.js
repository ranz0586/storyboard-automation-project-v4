import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getField } from './utils/field.js';
import { gemini } from './clients/gemini.js';
import { airtable } from './clients/airtable.js';
import { telegram } from './clients/telegram.js';
import { runContentPipeline } from './pipeline.js';
import { requireApiAuth } from './http/auth.js';
import { createRateLimiter } from './http/rateLimit.js';
import { TaskQueue } from './http/taskQueue.js';
import {
  NicheRequestSchema,
  ProjectCreateSchema,
  ScriptRunRequestSchema,
  WeeklyScheduleSchema,
  IdeaRunRequestSchema,
  validateBody,
} from './http/validation.js';
import { RunStore } from './runs/runStore.js';
import { ScriptRunController } from './runs/scriptRunController.js';
import { ScheduleStore } from './schedules/scheduleStore.js';
import { IdeaRunController } from './runs/ideaRunController.js';

export function createApp({
  authToken = config.server.authToken,
  makeGemini = gemini,
  makeAirtable = airtable,
  makeTelegram = telegram,
  runPipeline = runContentPipeline,
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
} = {}) {
  const app = express();
  const queue = pipelineQueue || new TaskQueue({
    maxConcurrency: config.server.maxConcurrentPipelines,
    maxQueued: config.server.maxQueuedPipelines,
    onError: (err) => logger.error('Pipeline failed', err?.message),
  });
  const store = runStore || new RunStore();
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

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  const authenticate = requireApiAuth(authToken);

  app.get('/api/projects', authenticate, readRateLimiter, async (req, res) => {
    try {
      const client = makeAirtable();
      const projects = await client.listProjects(req.query.limit);
      const stats = await client.projectStats(projects.map((project) => getField(project.fields, 'project_id')));
      return res.json({
        projects: projects.map((project) => ({ ...project, stats: stats[getField(project.fields, 'project_id')] })),
      });
    } catch (err) {
      logger.error('List projects failed', err?.message);
      return res.status(503).json({ error: 'Projects are temporarily unavailable' });
    }
  });

  app.post(
    '/api/projects',
    authenticate,
    rateLimiter,
    validateBody(ProjectCreateSchema),
    async (req, res) => {
      const input = req.validatedBody;
      try {
        const project = await makeAirtable().createProject({
          project_id: `dashboard_${input.requestId}`,
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

  app.get('/api/projects/:id', authenticate, readRateLimiter, async (req, res) => {
    try {
      const client = makeAirtable();
      const project = await client.getProject(req.params.id);
      const stats = await client.projectStats([project.fields.project_id]);
      console.log('Project stats:', stats[project.project_id]);
      return res.json({ project: { ...project, stats: stats[project.project_id] } });
    } catch (err) {
      if (err?.statusCode === 404 || err?.status === 404) {
        return res.status(404).json({ error: 'Project not found' });
      }
      logger.error('Get project failed', err?.message);
      return res.status(503).json({ error: 'Project is temporarily unavailable' });
    }
  });

  app.get('/api/projects/:id/ideas', authenticate, readRateLimiter, async (req, res) => {
    try {
      const ideas = await makeAirtable().listIdeasForProject(req.params.id, req.query.limit);
      return res.json({ ideas });
    } catch (err) {
      logger.error('List project ideas failed', err?.message);
      return res.status(503).json({ error: 'Ideas are temporarily unavailable' });
    }
  });

  app.post(
    '/api/projects/:id/idea-runs',
    authenticate,
    rateLimiter,
    validateBody(IdeaRunRequestSchema),
    (req, res) => {
      const run = ideaRuns.create({ projectId: req.params.id, count: req.validatedBody.count });
      if (!run) return res.status(503).json({ error: 'Pipeline queue is full' });
      return res.status(202).json({ run });
    }
  );

  app.post(
    '/api/script-runs',
    authenticate,
    rateLimiter,
    validateBody(ScriptRunRequestSchema),
    (req, res) => {
      const run = runs.create(req.validatedBody);
      if (!run) return res.status(503).json({ error: 'Pipeline queue is full' });
      return res.status(202).json({ run });
    }
  );

  app.get('/api/script-runs', authenticate, readRateLimiter, (req, res) => {
    return res.json({ runs: store.list({ projectId: req.query.projectId, limit: req.query.limit }) });
  });

  app.get('/api/script-runs/:id', authenticate, readRateLimiter, (req, res) => {
    const run = store.get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Pipeline run not found' });
    return res.json({ run });
  });

  app.post('/api/script-runs/:id/retry', authenticate, rateLimiter, (req, res) => {
    const result = runs.retry(req.params.id);
    if (result?.error === 'NOT_FOUND') return res.status(404).json({ error: 'Pipeline run not found' });
    if (result?.error === 'NO_FAILED_ITEMS') {
      return res.status(409).json({ error: 'Pipeline run has no failed ideas to retry' });
    }
    if (!result) return res.status(503).json({ error: 'Pipeline queue is full' });
    return res.status(202).json({ run: result });
  });

  app.get('/api/projects/:id/schedule', authenticate, readRateLimiter, (req, res) => {
    return res.json({ schedule: schedules.get(req.params.id) });
  });

  app.put(
    '/api/projects/:id/schedule',
    authenticate,
    rateLimiter,
    validateBody(WeeklyScheduleSchema),
    async (req, res) => {
      try {
        await makeAirtable().getProject(req.params.id);
        const schedule = schedules.set(req.params.id, req.validatedBody);
        return res.json({ schedule });
      } catch (err) {
        if (err?.statusCode === 404 || err?.status === 404) {
          return res.status(404).json({ error: 'Project not found' });
        }
        logger.error('Update schedule failed', err?.message);
        return res.status(503).json({ error: 'Schedule could not be updated' });
      }
    }
  );

  app.post(
    '/niche',
    requireApiAuth(authToken),
    rateLimiter,
    validateBody(NicheRequestSchema),
    (req, res) => {
      const form = req.validatedBody;
      let clients;
      try {
        clients = {
          gemini: makeGemini(),
          airtable: makeAirtable(),
          telegram: makeTelegram(),
          conceptCount: config.pipeline.conceptCount,
        };
      } catch (err) {
        logger.error('Client init failed', err?.message);
        return res.status(503).json({ error: 'Pipeline dependencies are unavailable' });
      }

      const accepted = queue.tryEnqueue(async () => {
        logger.info('Pipeline started', form.NICHE);
        const result = await runPipeline({ form, clients });
        logger.info('Pipeline complete', `${result.scriptCount} scripts`);
      });
      if (!accepted) {
        return res.status(503).json({ error: 'Pipeline queue is full' });
      }
      return res.status(202).json({ accepted: true, message: 'Pipeline queued' });
    }
  );

  return app;
}
