export function createRateLimiter({ limit = 5, windowMs = 60_000, now = Date.now } = {}) {
  const buckets = new Map();
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeWindowMs = Math.max(1_000, Number(windowMs) || 60_000);
  let requestsSinceCleanup = 0;

  return (req, res, next) => {
    const key = req.authRateLimitKey ? `account:${req.authRateLimitKey}`
      : req.ip || req.socket?.remoteAddress || 'unknown';
    const time = now();
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 100) {
      requestsSinceCleanup = 0;
      for (const [bucketKey, value] of buckets) {
        if (time >= value.resetAt) buckets.delete(bucketKey);
      }
    }
    let bucket = buckets.get(key);
    if (!bucket || time >= bucket.resetAt) {
      bucket = { count: 0, resetAt: time + safeWindowMs };
      buckets.set(key, bucket);
    }

    res.set('RateLimit-Limit', String(safeLimit));
    res.set('RateLimit-Remaining', String(Math.max(0, safeLimit - bucket.count - 1)));
    res.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count >= safeLimit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - time) / 1000))));
      return res.status(429).json({ error: 'Too many pipeline requests' });
    }
    bucket.count += 1;
    next();
  };
}
