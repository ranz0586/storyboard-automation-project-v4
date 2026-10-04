// Minimal structured logger. Swap for pino/winston if needed.
const ts = () => new Date().toISOString();

export const logger = {
  info: (msg, meta) => console.log(`[${ts()}] INFO  ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[${ts()}] WARN  ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[${ts()}] ERROR ${msg}`, meta ?? ''),
  // Rough heap snapshot — handy since the n8n version OOM'd at ~500MB.
  mem: (label) => {
    const { heapUsed, rss } = process.memoryUsage();
    const mb = (n) => `${Math.round(n / 1024 / 1024)}MB`;
    console.log(`[${ts()}] MEM   ${label} heap=${mb(heapUsed)} rss=${mb(rss)}`);
  },
};
