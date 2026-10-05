import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
const terminal = ['COMPLETED', 'PARTIAL', 'FAILED', 'INTERRUPTED'];
export class CloudState {
  constructor(db) {
    this.db = db;
    this.sessions = {
      get: async (id) =>
        (await db.query('SELECT payload FROM app_sessions WHERE id=$1 AND expires_at>now()', [id]))
          .rows[0]?.payload,
      set: (id, value) =>
        db.query(
          'INSERT INTO app_sessions(id,expires_at,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET expires_at=$2,payload=$3',
          [id, new Date(value.expiresAt), value],
        ),
      delete: (id) => db.query('DELETE FROM app_sessions WHERE id=$1', [id]),
      cleanup: () => db.query('DELETE FROM app_sessions WHERE expires_at<=now()'),
    };
  }
  async get(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || ''))
      return null;
    return (
      (await this.db.query('SELECT payload FROM app_runs WHERE id=$1', [id])).rows[0]?.payload ||
      null
    );
  }
  async list({ projectId, projectIds, limit = 20 } = {}) {
    if (!projectIds?.length) return [];
    const result = await this.db.query(
      'SELECT payload FROM app_runs WHERE project_id=ANY($1::text[]) AND ($2::text IS NULL OR project_id=$2) ORDER BY created_at DESC LIMIT $3',
      [projectIds, projectId || null, Math.max(1, Math.min(Number(limit) || 20, 100))],
    );
    return result.rows.map((row) => row.payload);
  }
  async change(id, work) {
    return this.db.transaction(async (tx) => {
      const run = (await tx.query('SELECT payload FROM app_runs WHERE id=$1 FOR UPDATE', [id]))
        .rows[0]?.payload;
      if (!run) throw new Error('Unknown pipeline run');
      await work(run);
      await tx.query('UPDATE app_runs SET payload=$2 WHERE id=$1', [id, run]);
      return run;
    });
  }
  update(id, patch) {
    return this.change(id, (run) => Object.assign(run, patch));
  }
  addItem(id, item) {
    return this.change(id, (run) => {
      const identity = item.ideaId || item.scriptId;
      if (identity && run.items.some((value) => (value.ideaId || value.scriptId) === identity))
        return;
      run.items.push({ ...item, at: new Date().toISOString() });
      run.processedCount = run.items.length;
      run.successfulCount = run.items.filter((value) => value.status === 'SUCCEEDED').length;
      run.failedCount = run.items.filter((value) => value.status === 'FAILED').length;
    });
  }
  async create(
    input,
    { source = 'MANUAL', type = 'SCRIPTS', occurrence = null, retryOf = null } = {},
  ) {
    return this.db.transaction(async (tx) => {
      // This lock only covers short submission/state updates, never provider work.
      await tx.query('SELECT pg_advisory_xact_lock(948372)');
      if (retryOf) {
        const prior = (
          await tx.query('SELECT payload FROM app_runs WHERE id=$1 FOR UPDATE', [retryOf])
        ).rows[0]?.payload;
        if (!prior) return { error: 'NOT_FOUND' };
        if (prior.recoveredByRunId)
          return (
            (await tx.query('SELECT payload FROM app_runs WHERE id=$1', [prior.recoveredByRunId]))
              .rows[0]?.payload || { error: 'NO_FAILED_ITEMS' }
          );
        if (prior.type !== 'SCRIPTS' || ['QUEUED', 'RUNNING'].includes(prior.status))
          return { error: 'NO_FAILED_ITEMS' };
        const success = new Set(
          prior.items.filter((v) => v.status === 'SUCCEEDED').map((v) => v.ideaId),
        );
        const unfinished = prior.selectedIdeaIds?.filter((id) => !success.has(id)) || [];
        const failed = prior.items
          .filter((v) => v.status === 'FAILED' && v.ideaId)
          .map((v) => v.ideaId);
        if (prior.status === 'INTERRUPTED' && !prior.selectedIdeaIds?.length) {
          input = {
            projectId: prior.projectId,
            mode: 'count',
            count: Math.max(0, prior.requestedCount - prior.successfulCount),
            preferredIdeaIds: [
              ...new Set(
                [prior.interruptedItem, ...failed, ...(prior.preferredIdeaIds || [])].filter(
                  Boolean,
                ),
              ),
            ],
          };
        } else
          input = {
            projectId: prior.projectId,
            mode: 'selected',
            ideaIds: prior.status === 'INTERRUPTED' ? unfinished : failed,
          };
        if (!(input.count || input.ideaIds?.length)) return { error: 'NO_FAILED_ITEMS' };
      }
      if (occurrence) {
        const found = (
          await tx.query(
            'SELECT payload FROM app_runs WHERE project_id=$1 AND source=$2 AND occurrence=$3',
            [input.projectId, source, occurrence],
          )
        ).rows[0]?.payload;
        if (found) {
          if (
            type === 'STORYBOARD' &&
            ['FAILED', 'PARTIAL', 'INTERRUPTED'].includes(found.status)
          ) {
            const active = Number(
              (
                await tx.query(
                  "SELECT count(*) AS n FROM app_runs WHERE payload->>'status' IN ('QUEUED','RUNNING')",
                )
              ).rows[0].n,
            );
            if (active >= config.server.maxQueuedPipelines + config.server.maxConcurrentPipelines)
              return null;
            Object.assign(found, {
              status: 'QUEUED',
              workflowId: null,
              plan: null,
              items: [],
              processedCount: 0,
              successfulCount: 0,
              failedCount: 0,
              currentItem: null,
              startedAt: null,
              completedAt: null,
              error: null,
              attempt: (found.attempt || 0) + 1,
            });
            await tx.query('UPDATE app_runs SET payload=$2 WHERE id=$1', [found.id, found]);
          }
          return found;
        }
      }
      const active = Number(
        (
          await tx.query(
            "SELECT count(*) AS n FROM app_runs WHERE payload->>'status' IN ('QUEUED','RUNNING')",
          )
        ).rows[0].n,
      );
      if (active >= config.server.maxQueuedPipelines + config.server.maxConcurrentPipelines)
        return null;
      const run = {
        id: randomUUID(),
        projectId: input.projectId,
        type,
        source,
        scheduledFor: occurrence,
        requestedCount: input.mode === 'selected' ? input.ideaIds.length : input.count,
        selectedIdeaIds: input.mode === 'selected' ? input.ideaIds : [],
        preferredIdeaIds: input.preferredIdeaIds || [],
        status: 'QUEUED',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        successfulCount: 0,
        failedCount: 0,
        processedCount: 0,
        currentItem: null,
        error: null,
        items: [],
      };
      await tx.query(
        'INSERT INTO app_runs(id,project_id,source,occurrence,payload) VALUES($1,$2,$3,$4,$5)',
        [run.id, run.projectId, source, occurrence, run],
      );
      if (retryOf)
        await tx.query(
          "UPDATE app_runs SET payload=payload||jsonb_build_object('recoveredByRunId',$2::text) WHERE id=$1",
          [retryOf, run.id],
        );
      return run;
    });
  }
  async getSchedule(projectId) {
    return (
      (await this.db.query('SELECT payload FROM app_schedules WHERE project_id=$1', [projectId]))
        .rows[0]?.payload || null
    );
  }
  async setSchedule(projectId, input) {
    return this.db.transaction(async (tx) => {
      const old = (
        await tx.query('SELECT payload FROM app_schedules WHERE project_id=$1 FOR UPDATE', [
          projectId,
        ])
      ).rows[0]?.payload;
      const value = {
        ...old,
        ...input,
        projectId,
        generation: randomUUID(),
        workflowId: null,
        updatedAt: new Date().toISOString(),
      };
      await tx.query(
        'INSERT INTO app_schedules(project_id,payload) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET payload=$2',
        [projectId, value],
      );
      return value;
    });
  }
  async listSchedules() {
    return (
      await this.db.query("SELECT payload FROM app_schedules WHERE payload->>'enabled'='true'")
    ).rows.map((row) => row.payload);
  }
  async queued() {
    return (
      await this.db.query(
        "SELECT payload FROM app_runs WHERE payload->>'status'='QUEUED' ORDER BY created_at LIMIT 20",
      )
    ).rows.map((row) => row.payload);
  }
  async claimWorkflow(id, workflowId) {
    return this.change(id, (run) => {
      if (!run.workflowId) run.workflowId = workflowId;
    }).then((run) => run.workflowId === workflowId && !terminal.includes(run.status));
  }
  async claimSchedule(projectId, generation, actor) {
    return this.db.transaction(async (tx) => {
      const value = (
        await tx.query('SELECT payload FROM app_schedules WHERE project_id=$1 FOR UPDATE', [
          projectId,
        ])
      ).rows[0]?.payload;
      if (!value?.enabled || value.generation !== generation) return false;
      if (value.workflowId && value.workflowId !== actor) return false;
      value.workflowId = actor;
      await tx.query('UPDATE app_schedules SET payload=$2 WHERE project_id=$1', [projectId, value]);
      return true;
    });
  }
  async resetScheduleOwner(projectId, generation, actor) {
    return this.db.query(
      "UPDATE app_schedules SET payload=payload-'workflowId' WHERE project_id=$1 AND payload->>'generation'=$2 AND payload->>'workflowId'=$3",
      [projectId, generation, actor],
    );
  }
  async markScheduled(projectId, generation, key, runId) {
    return this.db.query(
      "UPDATE app_schedules SET payload=payload||jsonb_build_object('lastRunKey',$3::text,'lastRunId',$4::text,'lastRunAt',now()) WHERE project_id=$1 AND payload->>'generation'=$2",
      [projectId, generation, key, runId],
    );
  }
  async active() {
    return (
      await this.db.query(
        "SELECT payload FROM app_runs WHERE payload->>'status' IN ('QUEUED','RUNNING') AND payload ? 'workflowId' LIMIT 100",
      )
    ).rows.map((r) => r.payload);
  }
  async effect(id) {
    return (await this.db.query('SELECT payload FROM app_effects WHERE id=$1', [id])).rows[0]
      ?.payload;
  }
  async replaceEffect(id, value) {
    await this.db.query(
      'INSERT INTO app_effects(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=$2',
      [id, JSON.stringify(value)],
    );
    return value;
  }
  async saveEffect(id, value) {
    await this.db.query(
      'INSERT INTO app_effects(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',
      [id, JSON.stringify(value)],
    );
    return value;
  }
}
