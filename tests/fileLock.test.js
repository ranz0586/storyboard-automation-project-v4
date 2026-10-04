import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('separate Node processes serialize work for the same idea', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'script-lock-'));
  try {
    const counter = path.join(directory, 'counter.txt');
    fs.writeFileSync(counter, '0');
    const lockModule = new URL('../src/utils/fileLock.js', import.meta.url).href;
    const worker = path.join(directory, 'worker.mjs');
    fs.writeFileSync(worker, `import fs from 'node:fs/promises';
import { withFileLock } from ${JSON.stringify(lockModule)};
for (let i = 0; i < 5; i++) await withFileLock('idea_rec1', async () => {
  const n = Number(await fs.readFile(${JSON.stringify(counter)}, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await fs.writeFile(${JSON.stringify(counter)}, String(n + 1));
}, { directory: ${JSON.stringify(path.join(directory, 'locks'))}, pollMs: 5 });`);
    await Promise.all([run(process.execPath, [worker]), run(process.execPath, [worker])]);
    assert.equal(fs.readFileSync(counter, 'utf8'), '10');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('separate script workers generate and persist one script for the same idea', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'script-worker-process-'));
  try {
    const worker = path.join(directory, 'worker.mjs');
    const scriptPath = path.join(directory, 'script.json');
    const generationPath = path.join(directory, 'generations.txt');
    const goPath = path.join(directory, 'go');
    const workerModule = new URL('../src/scriptWorker.js', import.meta.url).href;
    const validationFixture = new URL('./helpers/scriptValidation.js', import.meta.url).href;
    fs.writeFileSync(generationPath, '0');
    fs.writeFileSync(worker, `import fs from 'node:fs/promises';
import { withScriptValidation } from ${JSON.stringify(validationFixture)};
process.env.SCRIPT_LOCK_DIR = ${JSON.stringify(path.join(directory, 'locks'))};
const { processIdeaScript } = await import(${JSON.stringify(workerModule)});
await fs.writeFile(${JSON.stringify(path.join(directory, 'ready-'))} + process.argv[2], 'ready');
while (!(await fs.stat(${JSON.stringify(goPath)}).then(() => true, () => false)))
  await new Promise((resolve) => setTimeout(resolve, 5));
const result = await processIdeaScript({
  idea: { id: 'recShared', fields: { title: 'Shared' } },
  concept: { title: 'Shared' },
  form: { NICHE: 'Science', PLATFORM: 'YouTube' },
  projectKey: 'Science_YouTube',
  gemini: withScriptValidation(async () => {
    const n = Number(await fs.readFile(${JSON.stringify(generationPath)}, 'utf8'));
    await fs.writeFile(${JSON.stringify(generationPath)}, String(n + 1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { scripts: [{ video: {
      video_id: 'model-id', title: 'Shared script', estimated_duration_seconds: 30,
      voiceover: { full_script: 'Narration' },
    }, scenes: [{ scene_number: 1, duration_seconds: 3, narration: 'Scene' }] }] };
  }),
  airtable: {
    findScriptByVideoId: async () => fs.readFile(${JSON.stringify(scriptPath)}, 'utf8').then(JSON.parse, () => null),
    upsertScript: async (fields) => {
      const record = { id: 'recScript', fields };
      await fs.writeFile(${JSON.stringify(scriptPath)}, JSON.stringify(record));
      return record;
    },
  },
});
console.log(JSON.stringify({ generated: result.generated, id: result.script.id }));`);
    const launch = (id) => {
      const child = spawn(process.execPath, [worker, id], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      return new Promise((resolve, reject) => child.on('close', (code) => {
        if (code !== 0) reject(new Error(stderr || `worker exited ${code}`));
        else resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
      }));
    };
    const first = launch('first');
    const second = launch('second');
    for (let i = 0; i < 200; i++) {
      if (fs.existsSync(path.join(directory, 'ready-first')) && fs.existsSync(path.join(directory, 'ready-second'))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(fs.existsSync(path.join(directory, 'ready-first')));
    assert.ok(fs.existsSync(path.join(directory, 'ready-second')));
    fs.writeFileSync(goPath, 'go');
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((item) => item.generated).sort(), [false, true]);
    assert.deepEqual(results.map((item) => item.id), ['recScript', 'recScript']);
    assert.equal(fs.readFileSync(generationPath, 'utf8'), '1');
    assert.equal(JSON.parse(fs.readFileSync(scriptPath, 'utf8')).fields.video_id, 'idea_recShared');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
