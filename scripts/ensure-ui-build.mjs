import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
if (existsSync(vite)) {
  const result = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('Dashboard build missing. Install build dependencies with npm ci --include=dev and run npm run build before starting.');
  process.exit(1);
}
