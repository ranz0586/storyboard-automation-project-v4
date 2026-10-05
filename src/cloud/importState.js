import { randomUUID } from 'node:crypto';
// Used only by the operator migration command after stopping all local servers.
export async function importLocalState(db, { runs = [], schedules = [] } = {}) {
  return db.transaction(async (tx) => {
    let importedRuns = 0,
      importedSchedules = 0;
    for (const original of runs) {
      if (!original.id || !original.projectId) continue;
      const run = structuredClone(original);
      delete run.owner;
      delete run.workflowId;
      delete run.plan;
      if (['QUEUED', 'RUNNING'].includes(run.status))
        Object.assign(run, {
          status: 'INTERRUPTED',
          interruptedItem: run.currentItem,
          currentItem: null,
          completedAt: new Date().toISOString(),
          error: 'Local run stopped for Vercel migration; retry unfinished items',
        });
      const result = await tx.query(
        'INSERT INTO app_runs(id,project_id,source,occurrence,created_at,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
        [
          run.id,
          run.projectId,
          run.source || 'MANUAL',
          run.scheduledFor || null,
          run.createdAt,
          run,
        ],
      );
      importedRuns += result.rows.length;
    }
    for (const original of schedules) {
      if (!original.projectId) continue;
      const schedule = { ...original, generation: randomUUID(), workflowId: null };
      const result = await tx.query(
        'INSERT INTO app_schedules(project_id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING project_id',
        [schedule.projectId, schedule],
      );
      importedSchedules += result.rows.length;
    }
    return { importedRuns, importedSchedules };
  });
}
