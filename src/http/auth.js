import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hashPassword, verifyPassword } from './passwords.js';
import { createRateLimiter } from './rateLimit.js';
import { withFileLock } from '../utils/fileLock.js';
import { config } from '../config.js';

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,64}$/);
const loginSchema = z.object({ username, password: z.string().min(1).max(256) });
const registerSchema = loginSchema.extend({
  password: z.string().min(12).max(256),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
});
const digest = value => createHash('sha256').update(value).digest('hex');
const cookieName = 'dashboard_session';

export function publicUser(record) {
  return { id: record.id, username: record.fields.username,
    fullName: record.fields.full_name || '', email: record.fields.email || '',
    projectIds: Array.isArray(record.fields.Projects) ? record.fields.Projects : [] };
}

// Custom headers cannot be submitted by cross-site forms. No CORS permission
// is granted, so browsers cannot send credentialed cross-origin API writes.
export function requireSameOriginWrite(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-dashboard-request') !== '1' || req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Use the dashboard to submit this request' });
  }
  next();
}

export function createUserAuth({ makeAirtable, now = Date.now,
  sessionTtlMs = config.server.sessionTtlMs,
  secureCookies = config.server.secureCookies,
  lockDir = config.locks.userDir,
  sessionStore, withLock = withFileLock,
  loginRateLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 }),
  sessionRateLimiter = createRateLimiter({ limit: config.server.readRateLimitMax,
    windowMs: config.server.rateLimitWindowMs }),
} = {}) {
  const sessions = sessionStore || new Map();
  let passwordBusy = false;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  function sessionKey(req) {
    const value = (req.get('cookie') || '').split(';').map(v => v.trim())
      .find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? digest(value) : null;
  }
  async function issueSession(req, res, record) {
    if (sessions instanceof Map) { for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key); }
    else await sessions.cleanup();
    if (sessions.size >= 10000) throw new Error('Session capacity reached');
    const oldKey = sessionKey(req);
    if (oldKey) await sessions.delete(oldKey);
    const token = randomBytes(32).toString('hex');
    await sessions.set(digest(token), { userId: record.id,
      passwordDigest: digest(record.fields.password_hash), expiresAt: now() + sessionTtlMs });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionTtlMs });
  }
  async function activeSession(req) {
    const key = sessionKey(req), session = key && await sessions.get(key);
    if (!session || session.expiresAt <= now()) {
      if (key) await sessions.delete(key);
      return null;
    }
    return { key, session };
  }
  async function requireSession(req, res, next) {
    try {
      const active = await activeSession(req);
      if (!active) return res.status(401).json({ error: 'Please log in' });
      req.authSession = active;
      req.authRateLimitKey = active.session.userId;
      next();
    } catch { return res.status(503).json({ error: 'Login service is temporarily unavailable' }); }
  }
  async function authenticate(req, res, next) {
    let active;
    try { active = req.authSession || await activeSession(req); }
    catch { return res.status(503).json({ error: 'Login service is temporarily unavailable' }); }
    if (!active) return res.status(401).json({ error: 'Please log in' });
    const { key, session } = active;
    try {
      const record = await makeAirtable().getUser(session.userId);
      if (record.fields.status !== 'Active' || digest(record.fields.password_hash || '') !== session.passwordDigest) {
        await sessions.delete(key);
        return res.status(401).json({ error: 'Please log in' });
      }
      req.user = publicUser(record);
      next();
    } catch (err) {
      if (err.statusCode === 404 || err.status === 404) {
        await sessions.delete(key);
        return res.status(401).json({ error: 'Please log in' });
      }
      return res.status(503).json({ error: 'Login service is temporarily unavailable' });
    }
  }
  function mount(app) {
    app.use('/api/auth', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    for (const action of ['login', 'register']) {
      app.post(`/api/auth/${action}`, loginRateLimiter, requireSameOriginWrite, async (req, res) => {
        const parsed = (action === 'login' ? loginSchema : registerSchema).safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: action === 'login'
          ? 'Enter a valid username and password'
          : 'Enter your name, email, a username (3-64 letters, numbers, dots, underscores or dashes), and a password of at least 12 characters' });
        // Limit simultaneous password operations to keep memory bounded.
        if (passwordBusy) return res.status(503).json({ error: 'Login service is busy; please try again' });
        passwordBusy = true;
        try {
          const input = parsed.data, client = makeAirtable();
          let record;
          if (action === 'register') {
            record = await withLock(`user:${input.username}`, async () => {
              if (await client.findUserByUsername(input.username)) return null;
              return client.createUser({ username: input.username, full_name: input.fullName,
                email: input.email, password_hash: await hashPassword(input.password), status: 'Active' });
            }, { directory: lockDir });
            if (!record) return res.status(409).json({ error: 'Username is already in use' });
          } else {
            record = await client.findUserByUsername(input.username);
            const valid = await verifyPassword(input.password, record?.fields.password_hash);
            if (!valid || record?.fields.status !== 'Active') {
              return res.status(401).json({ error: 'Invalid username or password' });
            }
          }
          await issueSession(req, res, record);
          return res.status(action === 'register' ? 201 : 200).json({ user: publicUser(record) });
        } catch {
          return res.status(503).json({ error: 'Login service is temporarily unavailable' });
        } finally { passwordBusy = false; }
      });
    }
    app.get('/api/auth/me', requireSession, sessionRateLimiter, authenticate, (req, res) => res.json({ user: req.user }));
    app.post('/api/auth/logout', requireSameOriginWrite, async (req, res, next) => {
      try {
      const key = sessionKey(req);
      if (key) await sessions.delete(key);
      res.clearCookie(cookieName, cookieOptions);
      res.json({ ok: true });
      } catch (error) { next(error); }
    });
  }
  return { mount, authenticate, requireSession };
}
