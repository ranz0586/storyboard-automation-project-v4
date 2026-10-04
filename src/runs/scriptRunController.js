import { logger } from '../utils/logger.js';
import { unflattenIdea } from '../transforms.js';
import { processIdeaScript } from '../scriptWorker.js';
import { safeTelegram } from '../utils/alerts.js';
import { assertProjectActive, belongsToProject, projectKey } from '../utils/project.js';

function formFrom(project, idea) {
  const p = project?.fields || {};
  const f = idea?.fields || {};
  const platform = Array.isArray(f.platform) ? f.platform[0] : f.platform;
  return {
    NICHE: f.niche || p.niche || '',
    PLATFORM: platform || p.platform || '',
    'TARGET AUDIENCE': p.target_audience || '',
    'CONTENT STYLE': p.content_style || '',
    'Has Character Reference Sheet': p.has_character_reference || 'N',
    'Has Style Reference': p.has_style_reference || 'N',
  };
}

export class ScriptRunController {
  constructor({ store, queue, makeGemini, makeAirtable, makeTelegram }) {
    this.store = store;
    this.queue = queue;
    this.makeGemini = makeGemini;
    this.makeAirtable = makeAirtable;
    this.makeTelegram = makeTelegram;
  }

  create(input, { source = 'MANUAL' } = {}) {
    if (!this.queue.canAccept) return null;
    const selectedIdeaIds = input.mode === 'selected' ? input.ideaIds : [];
    const requestedCount = input.mode === 'selected' ? selectedIdeaIds.length : input.count;
    const run = this.store.create({
      projectId: input.projectId,
      requestedCount,
      selectedIdeaIds,
      preferredIdeaIds: input.mode === 'count' ? (input.preferredIdeaIds || []) : [],
      source,
      scheduledFor: source === 'SCHEDULED' ? input.scheduledFor : undefined,
    });
    const accepted = this.queue.tryEnqueue(() => this.#execute(run.id));
    if (!accepted) {
      this.store.update(run.id, {
        status: 'FAILED',
        completedAt: new Date().toISOString(),
        error: 'Pipeline queue is full',
      });
      return null;
    }
    return run;
  }

  retry(runId) {
    return this.store.transaction(() => this.#retry(runId));
  }

  #retry(runId) {
    const prior = this.store.get(runId);
    if (!prior) return { error: 'NOT_FOUND' };
    if (prior.type && prior.type !== 'SCRIPTS') return { error: 'NO_FAILED_ITEMS' };
    // Repeated resume requests must not enqueue another replacement run.
    if (prior.recoveredByRunId) {
      return this.store.get(prior.recoveredByRunId) || { error: 'NO_FAILED_ITEMS' };
    }
    if (['QUEUED', 'RUNNING'].includes(prior.status)) return { error: 'NO_FAILED_ITEMS' };
    const failedIds = prior.items
      .filter((item) => item.status === 'FAILED' && item.ideaId)
      .map((item) => item.ideaId);
    if (prior.status === 'INTERRUPTED') {
      let replacement;
      if (prior.selectedIdeaIds.length) {
        const succeeded = new Set(prior.items.filter((item) => item.status === 'SUCCEEDED').map((item) => item.ideaId));
        const pending = prior.selectedIdeaIds.filter((id) => !succeeded.has(id));
        if (pending.length) replacement = this.create({ projectId: prior.projectId, mode: 'selected', ideaIds: pending });
      } else {
        const remaining = Math.max(0, prior.requestedCount - prior.successfulCount);
        if (remaining) replacement = this.create({
          projectId: prior.projectId,
          mode: 'count',
          count: remaining,
          preferredIdeaIds: unfinishedIdeaIds(prior).slice(0, remaining),
        });
      }
      if (replacement) {
        this.store.update(runId, { recoveredByRunId: replacement.id });
        return replacement;
      }
      if (replacement === null) return null;
    }
    if (!failedIds.length) return { error: 'NO_FAILED_ITEMS' };
    return this.create({ projectId: prior.projectId, mode: 'selected', ideaIds: failedIds });
  }

  async #execute(runId) {
    const run = this.store.update(runId, {
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
    });
    let clients;
    try {
      clients = {
        airtable: this.makeAirtable(),
        telegram: this.makeTelegram(),
      };
      const project = await clients.airtable.getProject(run.projectId);
      assertProjectActive(project);
      clients.gemini = this.makeGemini();
      if (run.selectedIdeaIds.length) {
        for (const ideaId of run.selectedIdeaIds) {
          let idea;
          try {
            idea = await clients.airtable.getIdea(ideaId);
            if (!belongsToProject(idea, project)) {
              throw new Error('Idea does not belong to this project');
            }
            await this.#processOne(runId, idea, project, clients);
          } catch (err) {
            await this.#recordFailure(runId, idea || { id: ideaId, fields: {} }, err, clients.telegram);
          }
        }
      } else {
        const preferred = new Set(run.preferredIdeaIds || []);
        for (const ideaId of preferred) {
          let idea;
          try {
            idea = await clients.airtable.getIdea(ideaId);
            if (!belongsToProject(idea, project)) throw new Error('Idea does not belong to this project');
            await this.#processOne(runId, idea, project, clients);
          } catch (err) {
            await this.#recordFailure(runId, idea || { id: ideaId, fields: {} }, err, clients.telegram);
          }
        }
        const remaining = Math.max(0, run.requestedCount - preferred.size);
        if (remaining) {
        await clients.airtable.forEachEligibleIdea(
          run.projectId,
          { limit: Math.min(50, remaining + preferred.size) },
          (idea) => (preferred.has(idea.id) || this.store.get(runId).processedCount >= run.requestedCount)
            ? undefined : this.#processOne(runId, idea, project, clients)
        );
        }
      }
      this.#complete(runId);
    } catch (err) {
      logger.error(`Pipeline run ${runId} failed`, err?.message);
      const current = this.store.get(runId);
      this.store.update(runId, {
        status: current.successfulCount ? 'PARTIAL' : 'FAILED',
        completedAt: new Date().toISOString(),
        currentItem: null,
        error: err?.message || String(err),
      });
      if (clients?.telegram) {
        await safeTelegram('Pipeline run error', () => clients.telegram.errorAlert({
          workflowName: 'Script Pipeline Run',
          nodeName: runId,
          message: err?.message || String(err),
        }));
      }
    }
  }

  async #processOne(runId, idea, project, clients) {
    this.store.update(runId, { currentItem: idea.id });
    try {
      const result = await processIdeaScript({
        idea,
        concept: unflattenIdea(idea),
        form: formFrom(project, idea),
        projectKey: projectKey(project),
        gemini: clients.gemini,
        airtable: clients.airtable,
      });
      await clients.airtable.updateIdea(idea.id, { 'Idea Status': 'Script Generated' });
      const current = this.store.get(runId);
      this.store.addItem(runId, {
        ideaId: idea.id,
        scriptId: result.script.id,
        status: 'SUCCEEDED',
        generated: result.generated,
      });
      this.store.update(runId, {
        successfulCount: current.successfulCount + 1,
        processedCount: current.processedCount + 1,
      });
    } catch (err) {
      await this.#recordFailure(runId, idea, err, clients.telegram);
    } finally {
      this.store.update(runId, { currentItem: null });
      logger.mem(`run:${runId}:after:${idea.id}`);
    }
  }

  async #recordFailure(runId, idea, err, telegram) {
    const current = this.store.get(runId);
    this.store.addItem(runId, {
      ideaId: idea.id,
      status: 'FAILED',
      error: String(err?.message || err).slice(0, 1_000),
    });
    this.store.update(runId, {
      failedCount: current.failedCount + 1,
      processedCount: current.processedCount + 1,
    });
    await safeTelegram('Pipeline item error', () => telegram.errorAlert({
      workflowName: 'Script Pipeline Run',
      nodeName: idea.id,
      message: err?.message || String(err),
    }));
  }

  #complete(runId) {
    const current = this.store.get(runId);
    const shortfall = Math.max(0, current.requestedCount - current.processedCount);
    const failedCount = current.failedCount + shortfall;
    const status = failedCount === 0
      ? 'COMPLETED'
      : current.successfulCount > 0 ? 'PARTIAL' : 'FAILED';
    this.store.update(runId, {
      status,
      failedCount,
      completedAt: new Date().toISOString(),
      currentItem: null,
      error: shortfall ? `Only ${current.processedCount} eligible idea(s) were available` : null,
    });
  }
}

export function unfinishedIdeaIds(run) {
  const succeeded = new Set(run.items.filter((item) => item.status === 'SUCCEEDED').map((item) => item.ideaId));
  return [...new Set([
    ...run.items.filter((item) => item.status === 'FAILED').map((item) => item.ideaId),
    run.interruptedItem,
  ].filter((id) => id && !succeeded.has(id)))];
}
