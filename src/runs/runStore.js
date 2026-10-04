import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { JsonStateFile, isProcessOwnerAlive } from '../utils/jsonStateFile.js';

export class RunStore {
  #runs = new Map();
  #maxRuns;
  #state;
  #depth = 0;
  #owner = { pid: process.pid, host: os.hostname(), id: randomUUID() };
  #isOwnerAlive;

  constructor({ maxRuns = 200, filePath, isOwnerAlive = isProcessOwnerAlive } = {}) {
    this.#maxRuns = Math.max(10, Number(maxRuns) || 200);
    this.#state = new JsonStateFile(filePath, { runs: [] });
    this.#isOwnerAlive = isOwnerAlive;
    this.transaction(() => {});
  }

  transaction(work) {
    if (this.#depth) return work();
    return this.#state.transaction(state => {
      this.#runs = new Map((state.runs || []).map(run => [run.id, run]));
      for (const run of this.#runs.values()) {
        if (['QUEUED', 'RUNNING'].includes(run.status) && run.owner?.id !== this.#owner.id &&
            !this.#isOwnerAlive(run.owner)) {
          run.interruptedItem = run.currentItem;
          run.status = 'INTERRUPTED';
          run.error = 'Server restarted before this run completed';
          run.completedAt = new Date().toISOString();
          run.currentItem = null;
        }
      }
      this.#depth++;
      try {
        const result = work();
        this.#prune();
        state.runs = [...this.#runs.values()];
        return result;
      } finally { this.#depth--; }
    });
  }

  create({ projectId, requestedCount, selectedIdeaIds = [], preferredIdeaIds = [], source = 'MANUAL', type = 'SCRIPTS', scheduledFor }) {
    return this.transaction(() => this.#create({ projectId, requestedCount, selectedIdeaIds, preferredIdeaIds, source, type, scheduledFor }));
  }

  #create({ projectId, requestedCount, selectedIdeaIds, preferredIdeaIds, source, type, scheduledFor }) {
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(),
      projectId,
      type,
      source,
      scheduledFor,
      requestedCount,
      selectedIdeaIds,
      preferredIdeaIds,
      status: 'QUEUED',
      createdAt: now,
      startedAt: null,
      completedAt: null,
      successfulCount: 0,
      failedCount: 0,
      processedCount: 0,
      currentItem: null,
      error: null,
      items: [],
      owner: this.#owner,
    };
    this.#runs.set(run.id, run);
    this.#prune();
    return this.get(run.id);
  }

  get(id) {
    return this.transaction(() => this.#get(id));
  }
  #get(id) {
    const run = this.#runs.get(id);
    return run ? structuredClone(run) : null;
  }

  findScheduledRun(projectId, scheduledFor) {
    return this.transaction(() => structuredClone([...this.#runs.values()]
      .filter(run => run.projectId === projectId && run.source === 'SCHEDULED' && run.scheduledFor === scheduledFor)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null));
  }

  update(id, patch) {
    return this.transaction(() => this.#update(id, patch));
  }
  #update(id, patch) {
    const run = this.#runs.get(id);
    if (!run) throw new Error(`Unknown pipeline run: ${id}`);
    Object.assign(run, patch);
    this.#prune();
    return this.get(id);
  }

  addItem(id, item) {
    return this.transaction(() => this.#addItem(id, item));
  }
  #addItem(id, item) {
    const run = this.#runs.get(id);
    if (!run) throw new Error(`Unknown pipeline run: ${id}`);
    run.items.push({ ...item, at: new Date().toISOString() });
    return this.get(id);
  }

  list({ projectId, projectIds, limit = 20 } = {}) {
    return this.transaction(() => this.#list({ projectId, projectIds, limit }));
  }
  #list({ projectId, projectIds, limit }) {
    return [...this.#runs.values()]
      .filter((run) => !projectId || run.projectId === projectId)
      .filter((run) => !projectIds || projectIds.includes(run.projectId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 20, 100)))
      .map((run) => structuredClone(run));
  }

  #prune() {
    while (this.#runs.size > this.#maxRuns) {
      const oldestTerminal = [...this.#runs].find(([, run]) =>
        !['QUEUED', 'RUNNING'].includes(run.status) &&
        !(run.status === 'INTERRUPTED' && !run.recoveredByRunId));
      if (!oldestTerminal) break;
      this.#runs.delete(oldestTerminal[0]);
    }
  }

}
