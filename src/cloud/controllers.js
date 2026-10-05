import { contentRunWorkflow, weeklyScheduleWorkflow, maintenanceWorkflow } from './workflows.js';
import { getRun } from 'workflow/api';
export function cloudControllers(state, startWorkflow, { inspectWorkflow = getRun } = {}) {
  const dispatch = async (run) => {
    if (!run || (run.error && !run.id)) return run;
    try {
      await startWorkflow(maintenanceWorkflow, []);
    } catch {
      /* Cron backstop handles a temporarily unavailable workflow service. */
    }
    if (run.status === 'QUEUED' && !run.workflowId) {
      // Lost dispatch responses are safe: the first workflow actor claims the DB row.
      try {
        await startWorkflow(contentRunWorkflow, [run.id]);
      } catch {
        /* Durable queued row is reconciled by maintenance/cron. */
      }
    }
    return run;
  };
  const scripts = {
    create: async (input, options) => dispatch(await state.create(input, options)),
    retry: async (id) => dispatch(await state.create(null, { retryOf: id })),
    store: state,
  };
  const ideas = {
    create: async ({ projectId, count }) =>
      dispatch(await state.create({ projectId, count, mode: 'count' }, { type: 'IDEAS' })),
  };
  const startSchedule = async (schedule) => {
    if (schedule.enabled) {
      await startWorkflow(weeklyScheduleWorkflow, [schedule.projectId, schedule.generation]);
      await startWorkflow(maintenanceWorkflow, []);
    }
    return schedule;
  };
  const schedules = {
    get: (id) => state.getSchedule(id),
    set: async (id, input) => startSchedule(await state.setSchedule(id, input)),
  };
  const enqueueStoryboard = async ({ script, project }) => {
    const result = await dispatch(
      await state.create(
        { projectId: project.id, mode: 'selected', ideaIds: [script.id] },
        { type: 'STORYBOARD', source: 'APPROVAL', occurrence: 'storyboard:' + script.id },
      ),
    );
    if (!result) throw new Error('Pipeline queue is full; retry approval later');
    return result;
  };
  const reconcile = async () => {
    for (const run of await state.queued()) await dispatch(run);
    for (const schedule of await state.listSchedules()) {
      if (schedule.workflowId) {
        const previous = inspectWorkflow(schedule.workflowId);
        if (
          (await previous.exists) &&
          !['failed', 'cancelled', 'completed'].includes(await previous.status)
        )
          continue;
        await state.resetScheduleOwner(
          schedule.projectId,
          schedule.generation,
          schedule.workflowId,
        );
        await startSchedule(await state.getSchedule(schedule.projectId));
      } else await startSchedule(schedule);
    }
    await startWorkflow(maintenanceWorkflow, []);
  };
  return { scripts, ideas, schedules, enqueueStoryboard, reconcile };
}
