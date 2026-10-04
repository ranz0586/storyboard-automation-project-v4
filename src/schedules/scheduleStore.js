import { JsonStateFile } from '../utils/jsonStateFile.js';

export class ScheduleStore {
  #state;
  #depth = 0;
  #schedules = new Map();
  #now;

  constructor({ filePath, now = () => new Date() } = {}) {
    this.#state = new JsonStateFile(filePath, { schedules: [] });
    this.#now = now;
    this.transaction(() => {});
  }

  transaction(work) {
    if (this.#depth) return work();
    return this.#state.transaction(state => {
      this.#schedules = new Map((state.schedules || []).map(schedule => [schedule.projectId, schedule]));
      this.#depth++;
      try {
        const result = work();
        state.schedules = [...this.#schedules.values()];
        return result;
      } finally { this.#depth--; }
    });
  }

  get(projectId) {
    return this.transaction(() => this.#get(projectId));
  }
  #get(projectId) {
    const schedule = this.#schedules.get(projectId);
    return schedule ? structuredClone(schedule) : null;
  }

  set(projectId, input) {
    return this.transaction(() => this.#set(projectId, input));
  }
  #set(projectId, input) {
    const previous = this.#schedules.get(projectId);
    const schedule = {
      projectId,
      enabled: input.enabled,
      dayOfWeek: input.dayOfWeek,
      time: input.time,
      scriptCount: input.scriptCount,
      lastRunKey: previous?.lastRunKey || null,
      lastRunId: previous?.lastRunId || null,
      lastRunAt: previous?.lastRunAt || null,
      updatedAt: this.#now().toISOString(),
    };
    this.#schedules.set(projectId, schedule);
    return this.get(projectId);
  }

  markRun(projectId, runKey, runId) {
    return this.transaction(() => this.#markRun(projectId, runKey, runId));
  }
  #markRun(projectId, runKey, runId) {
    const schedule = this.#schedules.get(projectId);
    if (!schedule) return null;
    schedule.lastRunKey = runKey;
    schedule.lastRunId = runId;
    schedule.lastRunAt = this.#now().toISOString();
    return this.get(projectId);
  }

  clearInterruptedRun(projectId, runId) {
    return this.transaction(() => this.#clearInterruptedRun(projectId, runId));
  }
  #clearInterruptedRun(projectId, runId) {
    const schedule = this.#schedules.get(projectId);
    if (!schedule || schedule.lastRunId !== runId) return null;
    schedule.lastRunKey = null;
    schedule.lastRunId = null;
    schedule.lastRunAt = null;
    return this.get(projectId);
  }

  listEnabled() {
    return this.transaction(() => this.#listEnabled());
  }
  #listEnabled() {
    return [...this.#schedules.values()]
      .filter((schedule) => schedule.enabled)
      .map((schedule) => structuredClone(schedule));
  }

}
