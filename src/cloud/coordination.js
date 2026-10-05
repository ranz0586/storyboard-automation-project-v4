import { randomUUID, createHash } from 'node:crypto';
export class DeferredError extends Error {
  constructor(message, retryAt = Date.now() + 30000) {
    super(message);
    this.code = 'DEFERRED';
    this.retryAt = retryAt;
  }
}
export function createDatabaseLock(db) {
  return async function withLock(id, work) {
    const owner = randomUUID(),
      ttl = 15 * 60 * 1000;
    const lease = await db.query(
      "INSERT INTO app_leases(id,owner,expires_at) VALUES($1,$2,now()+($3*interval '1 millisecond')) ON CONFLICT(id) DO UPDATE SET owner=$2,expires_at=now()+($3*interval '1 millisecond') WHERE app_leases.expires_at<=now() RETURNING owner",
      [id, owner, ttl],
    );
    if (!lease.rows.length) throw new DeferredError('Work is already owned by another execution');
    let lost = false;
    const check = () => {
      if (lost) throw new DeferredError('Execution lease was lost');
    };
    const heartbeat = setInterval(() => {
      db.query(
        "UPDATE app_leases SET expires_at=now()+($3*interval '1 millisecond') WHERE id=$1 AND owner=$2 RETURNING owner",
        [id, owner, ttl],
      )
        .then((result) => {
          if (!result.rows.length) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, 30000);
    heartbeat.unref?.();
    try {
      return await work(check);
    } finally {
      clearInterval(heartbeat);
      await db.query('DELETE FROM app_leases WHERE id=$1 AND owner=$2', [id, owner]);
    }
  };
}
export function databaseRateLimiter(db, { name, limit, windowMs }) {
  return async (req, res, next) => {
    try {
      const id = name + ':' + (req.authRateLimitKey || req.ip || 'unknown');
      const { rows } = await db.query(
        "INSERT INTO app_rate_limits(id,count,reset_at) VALUES($1,1,now()+($2*interval '1 millisecond')) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN app_rate_limits.reset_at<=now() THEN 1 ELSE app_rate_limits.count+1 END,reset_at=CASE WHEN app_rate_limits.reset_at<=now() THEN now()+($2*interval '1 millisecond') ELSE app_rate_limits.reset_at END RETURNING count,reset_at",
        [id, windowMs],
      );
      const count = Number(rows[0].count),
        reset = new Date(rows[0].reset_at).getTime();
      res.set('RateLimit-Limit', String(limit));
      res.set('RateLimit-Remaining', String(Math.max(0, limit - count)));
      if (count > limit) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
        return res.status(429).json({ error: 'Too many requests' });
      }
      next();
    } catch {
      res.status(503).json({ error: 'Request service is temporarily unavailable' });
    }
  };
}
export class DatabaseKeyPool {
  constructor(db, keys, cooldownMs) {
    this.db = db;
    this.keys = keys;
    this.size = keys.length;
    this.cooldownMs = Math.max(0, cooldownMs);
  }
  async acquire() {
    const ids = this.keys.map((key) => createHash('sha256').update(key).digest('hex'));
    await this.db.query(
      'INSERT INTO app_key_slots(id,available_at) SELECT unnest($1::text[]),now() ON CONFLICT DO NOTHING',
      [ids],
    );
    const result = await this.db.query(
      "WITH candidate AS (SELECT id FROM app_key_slots WHERE id=ANY($1::text[]) AND available_at<=now() ORDER BY available_at,array_position($1::text[],id) LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE app_key_slots SET available_at=now()+($2*interval '1 millisecond') FROM candidate WHERE app_key_slots.id=candidate.id RETURNING app_key_slots.id",
      [ids, this.cooldownMs],
    );
    if (result.rows.length) {
      const index = ids.indexOf(result.rows[0].id);
      return { key: this.keys[index], index };
    }
    const next = (
      await this.db.query(
        'SELECT min(available_at) AS at FROM app_key_slots WHERE id=ANY($1::text[])',
        [ids],
      )
    ).rows[0]?.at;
    throw new DeferredError(
      'Gemini keys are cooling down',
      Math.max(Date.now() + 1000, new Date(next || Date.now() + this.cooldownMs).getTime()),
    );
  }
}
