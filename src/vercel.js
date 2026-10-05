import { timingSafeEqual } from 'node:crypto';
import { start } from 'workflow/api';
import { createApp } from './app.js';
import { cloudContext } from './cloud/context.js';
import { cloudControllers } from './cloud/controllers.js';
import { databaseRateLimiter } from './cloud/coordination.js';
import { config } from './config.js';
let application, controllers;
function initialize() {
  const { db, state, withLock } = cloudContext();
  controllers = cloudControllers(state, start);
  application = createApp({
    runStore: state,
    scheduleStore: controllers.schedules,
    scriptRunController: controllers.scripts,
    ideaRunController: controllers.ideas,
    pipelineQueue: {},
    authOptions: {
      sessionStore: state.sessions,
      withLock,
      secureCookies: config.server.secureCookies,
      loginRateLimiter: databaseRateLimiter(db, { name: 'login', limit: 10, windowMs: 15 * 60000 }),
    },
    rateLimiter: databaseRateLimiter(db, {
      name: 'write',
      limit: config.server.rateLimitMax,
      windowMs: config.server.rateLimitWindowMs,
    }),
    readRateLimiter: databaseRateLimiter(db, {
      name: 'read',
      limit: config.server.readRateLimitMax,
      windowMs: config.server.rateLimitWindowMs,
    }),
    onScriptApproved: controllers.enqueueStoryboard,
  });
}
export default async function handler(req, res) {
  try {
    if (req.url?.split('?')[0] === '/api/cron') {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }
      const expected = process.env.CRON_SECRET,
        actual = Buffer.from(req.headers.authorization || '');
      if (
        !expected ||
        actual.length !== Buffer.byteLength('Bearer ' + expected) ||
        !timingSafeEqual(actual, Buffer.from('Bearer ' + expected))
      ) {
        res.statusCode = 401;
        res.end('Unauthorized');
        return;
      }
      if (!application) initialize();
      await controllers.reconcile();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!application) initialize();
    if (req.url?.split('?')[0] === '/health')
      await cloudContext().db.query('SELECT 1 FROM app_runs LIMIT 0');
    return application(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Cloud runtime is not ready. Check database configuration and migrations.',
      }),
    );
  }
}
