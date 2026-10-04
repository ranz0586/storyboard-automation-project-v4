import { logger } from '../utils/logger.js';
import { generateIdeasForProject } from '../ideaGeneration.js';
import { assertProjectActive } from '../utils/project.js';

export class IdeaRunController {
  constructor({ store, queue, makeGemini, makeAirtable }) {
    this.store = store;
    this.queue = queue;
    this.makeGemini = makeGemini;
    this.makeAirtable = makeAirtable;
  }

  create({ projectId, count }) {
    if (!this.queue.canAccept) return null;
    const run = this.store.create({
      projectId,
      requestedCount: count,
      source: 'MANUAL',
      type: 'IDEAS',
    });
    if (!this.queue.tryEnqueue(() => this.#execute(run.id))) return null;
    return run;
  }

  async #execute(runId) {
    const run = this.store.update(runId, {
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
    });
    try {
      const airtable = this.makeAirtable();
      const project = await airtable.getProject(run.projectId);
      assertProjectActive(project);
      const result = await generateIdeasForProject({
        project,
        count: run.requestedCount,
        gemini: this.makeGemini(),
        airtable,
        onSaved: ({ idea, savedCount }) => {
          this.store.addItem(runId, { ideaId: idea.id, status: 'SUCCEEDED' });
          this.store.update(runId, {
            successfulCount: savedCount,
            processedCount: savedCount,
            currentItem: idea.id,
          });
        },
      });
      const shortfall = Math.max(0, run.requestedCount - result.savedCount);
      this.store.update(runId, {
        status: shortfall ? (result.savedCount ? 'PARTIAL' : 'FAILED') : 'COMPLETED',
        failedCount: shortfall,
        currentItem: null,
        completedAt: new Date().toISOString(),
        error: shortfall ? `Gemini returned ${result.savedCount} of ${run.requestedCount} requested ideas` : null,
      });
    } catch (err) {
      logger.error(`Idea run ${runId} failed`, err?.message);
      const current = this.store.get(runId);
      this.store.update(runId, {
        status: current.successfulCount ? 'PARTIAL' : 'FAILED',
        currentItem: null,
        completedAt: new Date().toISOString(),
        error: err?.message || String(err),
      });
    }
  }
}
