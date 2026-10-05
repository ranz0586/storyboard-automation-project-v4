import fs from 'node:fs';
import { database } from '../src/cloud/database.js';
import { importLocalState } from '../src/cloud/importState.js';
import { config } from '../src/config.js';
let db;
try {
  const importing = process.argv.includes('--import-local');
  if (importing && !process.argv.includes('--servers-stopped'))
    throw new Error('Stop local servers first');
  db = database();
  await db.query(fs.readFileSync(new URL('../src/cloud/schema.sql', import.meta.url), 'utf8'));
  console.log('Cloud database schema installed');
  if (importing) {
    const read = (file, field) =>
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))[field] || [] : [];
    const counts = await importLocalState(db, {
      runs: read(config.scheduler.runStatePath, 'runs'),
      schedules: read(config.scheduler.statePath, 'schedules'),
    });
    console.log(
      'Imported ' + counts.importedRuns + ' runs and ' + counts.importedSchedules + ' schedules',
    );
  }
} catch {
  console.error(
    'Database migration failed. Check DATABASE_URL/SUPABASE_POOLER, connectivity, schema permissions and --servers-stopped when importing.',
  );
  process.exitCode = 1;
} finally {
  if (db) await db.pool.end();
}
