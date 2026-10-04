import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-build-'));
  try {
    await fs.mkdir(path.join(root, 'scripts'));
    const script = path.join(root, 'scripts', 'ensure-ui-build.mjs');
    await fs.copyFile(new URL('../scripts/ensure-ui-build.mjs', import.meta.url), script);
    await fn(root, script);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('startup accepts prebuilt dashboard without development dependencies', async () => {
  await fixture(async (root, script) => {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'index.html'), '<div id="root"></div>');
    await run(process.execPath, [script]);
  });
});

test('startup explains a missing dashboard build instead of silently serving no UI', async () => {
  await fixture(async (_root, script) => {
    await assert.rejects(run(process.execPath, [script]), error => error.code === 1 && /Dashboard build missing/.test(error.stderr));
  });
});

test('startup runs the installed build tool from the repository root and propagates failure', async () => {
  await fixture(async (root, script) => {
    const bin = path.join(root, 'node_modules', 'vite', 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, 'vite.js'), "console.log(process.argv[2]); console.log(process.cwd()); process.exit(7);");
    await assert.rejects(run(process.execPath, [script]), error => error.code === 7 && error.stdout.includes('build') && error.stdout.includes(root));
  });
});
