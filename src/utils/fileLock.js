import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// mkdir is atomic across processes sharing a filesystem. A heartbeat permits
// reclaiming locks left by a crashed worker without stealing a long Gemini run.
export async function withFileLock(key, work, {
  directory,
  pollMs = 250,
  staleMs = 10 * 60_000,
  heartbeatMs = 30_000,
} = {}) {
  if (!directory) throw new Error('A shared lock directory is required');
  const root = path.resolve(directory);
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, createHash('sha256').update(key).digest('hex'));
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let before;
      try { before = await fs.stat(lockPath); }
      catch (statErr) { if (statErr.code === 'ENOENT') continue; throw statErr; }
      if (Date.now() - before.mtimeMs > staleMs) {
        // Remove only the known empty lock directory after checking its age.
        // A concurrent owner refresh may make rmdir fail, in which case wait.
        const after = await fs.stat(lockPath).catch(() => null);
        if (after && after.mtimeMs === before.mtimeMs) {
          await fs.rmdir(lockPath).catch((removeErr) => {
            if (!['ENOENT', 'ENOTEMPTY', 'EACCES'].includes(removeErr.code)) throw removeErr;
          });
        }
      }
      await wait(pollMs);
    }
  }
  const heartbeat = setInterval(() => {
    const now = new Date();
    fs.utimes(lockPath, now, now).catch(() => {});
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await fs.rmdir(lockPath);
  }
}
