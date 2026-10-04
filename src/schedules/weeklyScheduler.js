import { logger } from '../utils/logger.js';
import { unfinishedIdeaIds } from '../runs/scriptRunController.js';

const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedMinute(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const time = `${value('hour')}:${value('minute')}`;
  return {
    dayOfWeek: days[value('weekday')],
    time,
    year: Number(year),
    month: Number(month),
    day: Number(day),
    runKey: `${year}-${month}-${day}T${time}`,
  };
}

export function latestWeeklyRunKey(schedule, now, timeZone) {
  const local = zonedMinute(now, timeZone);
  let daysBack = (local.dayOfWeek - schedule.dayOfWeek + 7) % 7;
  if (daysBack === 0 && local.time < schedule.time) daysBack = 7;
  const dueDate = new Date(Date.UTC(local.year, local.month - 1, local.day - daysBack));
  const year = dueDate.getUTCFullYear();
  const month = String(dueDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dueDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T${schedule.time}`;
}

export class WeeklyScheduler {
  constructor({ scheduleStore, scriptRunController, timeZone = 'UTC' }) {
    this.scheduleStore = scheduleStore;
    this.scriptRunController = scriptRunController;
    this.timeZone = timeZone;
  }

  tick(now = new Date()) {
    return typeof this.scheduleStore.transaction === 'function'
      ? this.scheduleStore.transaction(() => this.#tick(now)) : this.#tick(now);
  }

  #tick(now) {
    const started = [];
    for (const schedule of this.scheduleStore.listEnabled()) {
      const dueKey = latestWeeklyRunKey(schedule, now, this.timeZone);
      // Recover a run written immediately before a crash in schedule marking.
      // Its occurrence identity prevents creating another run for the same tick.
      const existing = this.scriptRunController.store?.findScheduledRun?.(schedule.projectId, dueKey);
      if (existing && existing.id !== schedule.lastRunId) {
        this.scheduleStore.markRun(schedule.projectId, dueKey, existing.id);
        schedule.lastRunId = existing.id;
        schedule.lastRunKey = dueKey;
      }
      let previous = schedule.lastRunId && this.scriptRunController.store?.get(schedule.lastRunId);
      const visited = new Set();
      while (previous?.recoveredByRunId) {
        if (visited.has(previous.id)) throw new Error('Cyclic run recovery chain');
        visited.add(previous.id);
        const replacement = this.scriptRunController.store?.get(previous.recoveredByRunId);
        if (!replacement) break;
        previous = replacement;
        this.scheduleStore.markRun(schedule.projectId, schedule.lastRunKey || dueKey, replacement.id);
        schedule.lastRunId = replacement.id;
      }
      const interruptedRunId = previous?.status === 'INTERRUPTED' ? previous.id : null;
      const unfinishedCount = interruptedRunId
        ? Math.max(0, previous.requestedCount - previous.successfulCount) : null;
      if (interruptedRunId && unfinishedCount === 0) {
        this.scriptRunController.store.update(interruptedRunId, {
          status: 'COMPLETED',
          error: null,
        });
      }
      if (interruptedRunId && unfinishedCount > 0) {
        this.scheduleStore.clearInterruptedRun(schedule.projectId, interruptedRunId);
        schedule.lastRunKey = null;
      }
      // A newly created/changed schedule starts with the first occurrence after
      // the change; it must not backfill an occurrence that predated the user's
      // configuration. Once effective, a missed poll is caught up on the next
      // tick instead of being lost for an entire week.
      const effectiveKey = schedule.updatedAt
        ? latestWeeklyRunKey(schedule, new Date(schedule.updatedAt), this.timeZone)
        : null;
      if ((schedule.lastRunKey && schedule.lastRunKey >= dueKey) ||
          (!interruptedRunId && effectiveKey && dueKey <= effectiveKey)) continue;
      const run = this.scriptRunController.create({
        projectId: schedule.projectId,
        mode: 'count',
        count: unfinishedCount > 0 ? unfinishedCount : schedule.scriptCount,
        scheduledFor: dueKey,
        ...(unfinishedCount > 0 ? { preferredIdeaIds: unfinishedIdeaIds(previous).slice(0, unfinishedCount) } : {}),
      }, { source: 'SCHEDULED' });
      if (!run) {
        logger.warn(`Scheduled run for ${schedule.projectId} deferred — pipeline queue is full`);
        continue;
      }
      this.scheduleStore.markRun(schedule.projectId, dueKey, run.id);
      if (interruptedRunId && unfinishedCount > 0) {
        this.scriptRunController.store?.update(interruptedRunId, { recoveredByRunId: run.id });
      }
      started.push(run);
      logger.info(`Scheduled run ${run.id} queued`, schedule.projectId);
    }
    return started;
  }
}
