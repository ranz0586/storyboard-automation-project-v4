import { sleep, getWorkflowMetadata } from 'workflow';
import { cloudContext } from './context.js';
import { processIdeaScript } from '../scriptWorker.js';
import { processScriptStoryboard } from '../storyboardWorker.js';
import { generateIdeasForProject, formFromProject } from '../ideaGeneration.js';
import { unflattenIdea } from '../transforms.js';
import { assertProjectActive, belongsToProject, projectKey } from '../utils/project.js';
import { latestWeeklyRunKey } from '../schedules/weeklyScheduler.js';
import { nextWeeklyDate } from './schedule.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { safeTelegram } from '../utils/alerts.js';
import { start, getRun } from 'workflow/api';

export async function contentRunWorkflow(id) {
  'use workflow';
  const actor = getWorkflowMetadata().workflowRunId;
  try {
    const plan = await prepareRun(id, actor);
    if (!plan) return;
    if (plan.type === 'IDEAS') {
      let value = await executeIdeas(id);
      while (value?.deferredUntil) {
        await sleep(new Date(value.deferredUntil));
        value = await executeIdeas(id);
      }
    } else
      for (const itemId of plan.ids) {
        let value = await executeItem(id, itemId, plan.type);
        while (value?.deferredUntil) {
          await sleep(new Date(value.deferredUntil));
          value = await executeItem(id, itemId, plan.type);
        }
      }
    await finishRun(id);
  } catch {
    await interruptRun(id);
  }
}
async function interruptRun(id) {
  'use step';
  const { state } = cloudContext();
  const run = await state.get(id);
  if (run && ['QUEUED', 'RUNNING'].includes(run.status))
    await state.update(id, {
      status: 'INTERRUPTED',
      interruptedItem: run.currentItem,
      currentItem: null,
      completedAt: new Date().toISOString(),
      error: 'Workflow stopped before completion; retry unfinished items',
    });
}
async function prepareRun(id, actor) {
  'use step';
  const { state, clients } = cloudContext();
  if (!(await state.claimWorkflow(id, actor))) return null;
  const run = await state.get(id);
  if (run.plan) return run.plan;
  try {
    const client = clients('run:' + id).airtable;
    const project = await client.getProject(run.projectId);
    assertProjectActive(project);
    const ids = [...run.selectedIdeaIds];
    if (run.type === 'SCRIPTS' && !ids.length) {
      ids.push(...run.preferredIdeaIds);
      await client.forEachEligibleIdea(run.projectId, { limit: 50 }, (idea) => {
        if (ids.length < run.requestedCount && !ids.includes(idea.id)) ids.push(idea.id);
      });
    }
    const plan = { type: run.type, ids: ids.slice(0, run.requestedCount) };
    await state.update(id, { status: 'RUNNING', startedAt: new Date().toISOString(), plan });
    return plan;
  } catch (error) {
    await state.update(id, {
      status: 'FAILED',
      error: String(error.message).slice(0, 1000),
      completedAt: new Date().toISOString(),
    });
    await finishRun(id);
    return null;
  }
}
async function executeIdeas(id) {
  'use step';
  const { state, clients, withSlot } = cloudContext();
  try {
    return await withSlot(async () => {
      const run = await state.get(id),
        c = clients('run:' + id + ':attempt:' + (run.attempt || 0));
      const project = await c.airtable.getProject(run.projectId);
      assertProjectActive(project);
      await generateIdeasForProject({
        project,
        count: run.requestedCount,
        ...c,
        onSaved: async ({ idea }) => {
          await state.addItem(id, { ideaId: idea.id, status: 'SUCCEEDED' });
        },
      });
      return {};
    });
  } catch (error) {
    if (error.code === 'DEFERRED') return { deferredUntil: error.retryAt };
    await state.update(id, { error: String(error.message).slice(0, 1000) });
    return {};
  }
}
async function executeItem(id, itemId, type) {
  'use step';
  const { state, clients, withLock, withSlot } = cloudContext();
  try {
    return await withSlot(async () => {
      const run = await state.get(id);
      if (run.items.some((item) => (item.ideaId || item.scriptId) === itemId)) return {};
      await state.update(id, { currentItem: itemId });
      const c = clients('run:' + id + ':attempt:' + (run.attempt || 0) + ':item:' + itemId),
        project = await c.airtable.getProject(run.projectId);
      assertProjectActive(project);
      if (type === 'STORYBOARD') {
        const script = await c.airtable.getScript(itemId);
        if (!belongsToProject(script, project))
          throw new Error('Script does not belong to this project');
        const result = await processScriptStoryboard({
          scriptRecord: script,
          clients: c,
          withLock,
        });
        await state.addItem(id, {
          scriptId: itemId,
          storyboardId: result.storyboardId,
          generated: result.generated,
          status: 'SUCCEEDED',
        });
      } else {
        const idea = await c.airtable.getIdea(itemId);
        if (!belongsToProject(idea, project))
          throw new Error('Idea does not belong to this project');
        const form = {
          ...formFromProject(project),
          NICHE: idea.fields.niche || project.fields.niche,
          PLATFORM: Array.isArray(idea.fields.platform)
            ? idea.fields.platform[0]
            : idea.fields.platform || project.fields.platform,
        };
        const result = await processIdeaScript({
          idea,
          concept: unflattenIdea(idea),
          form,
          projectKey: projectKey(project),
          ...c,
          withLock,
        });
        await c.airtable.updateIdea(idea.id, { 'Idea Status': 'Script Generated' });
        await state.addItem(id, {
          ideaId: itemId,
          scriptId: result.script.id,
          generated: result.generated,
          status: 'SUCCEEDED',
        });
      }
      return {};
    });
  } catch (error) {
    if (error.code === 'DEFERRED') return { deferredUntil: error.retryAt };
    await state.addItem(id, {
      ...(type === 'STORYBOARD' ? { scriptId: itemId } : { ideaId: itemId }),
      status: 'FAILED',
      error: String(error.message).slice(0, 1000),
    });
    return {};
  } finally {
    logger.mem('cloud-run:' + id + ':item:' + itemId);
  }
}
async function finishRun(id) {
  'use step';
  const { state, clients } = cloudContext();
  const completed = await state.change(id, (run) => {
    const failed = Math.max(run.failedCount, run.requestedCount - run.successfulCount);
    Object.assign(run, {
      status: failed ? (run.successfulCount ? 'PARTIAL' : 'FAILED') : 'COMPLETED',
      failedCount: failed,
      currentItem: null,
      completedAt: new Date().toISOString(),
      error:
        run.error ||
        (run.processedCount < run.requestedCount
          ? 'Fewer eligible items were available than requested'
          : null),
    });
  });
  if (completed.failedCount) {
    const alertId = 'run:' + id + ':error-alert';
    if ((await state.effect(alertId)) === undefined) {
      await state.saveEffect(alertId, true);
      await safeTelegram('Cloud run error', () =>
        clients('run:' + id).telegram.errorAlert({
          workflowName: completed.type + ' Run',
          nodeName: id,
          message: completed.error || completed.failedCount + ' item(s) failed',
        }),
      );
    }
  }
}
export async function weeklyScheduleWorkflow(projectId, generation) {
  'use workflow';
  const actor = getWorkflowMetadata().workflowRunId;
  while (true) {
    const next = await checkSchedule(projectId, generation, actor);
    if (!next) return;
    await sleep(new Date(next));
  }
}
async function checkSchedule(projectId, generation, actor) {
  'use step';
  const { state } = cloudContext(),
    schedule = await state.getSchedule(projectId);
  if (
    !schedule?.enabled ||
    schedule.generation !== generation ||
    !(await state.claimSchedule(projectId, generation, actor))
  )
    return null;
  const now = new Date(),
    due = latestWeeklyRunKey(schedule, now, config.scheduler.timeZone);
  const effective = latestWeeklyRunKey(
    schedule,
    new Date(schedule.updatedAt),
    config.scheduler.timeZone,
  );
  if (due > effective && (!schedule.lastRunKey || due > schedule.lastRunKey)) {
    const run = await state.create(
      { projectId, mode: 'count', count: schedule.scriptCount },
      { source: 'SCHEDULED', occurrence: due },
    );
    if (!run) return Date.now() + 60000;
    if (run?.status === 'QUEUED' && !run.workflowId) await start(contentRunWorkflow, [run.id]);
    await state.markScheduled(projectId, generation, due, run.id);
  }
  return nextWeeklyDate(schedule, now, config.scheduler.timeZone).getTime();
}
export async function maintenanceWorkflow() {
  'use workflow';
  const actor = getWorkflowMetadata().workflowRunId;
  while (await maintain(actor)) await sleep('1m');
}
async function maintain(actor) {
  'use step';
  const { db, state } = cloudContext();
  const claim = await db.query(
    "INSERT INTO app_maintenance(id,owner,updated_at) VALUES('main',$1,now()) ON CONFLICT(id) DO UPDATE SET owner=$1,updated_at=now() WHERE app_maintenance.owner=$1 OR app_maintenance.updated_at<now()-interval '10 minutes' RETURNING owner",
    [actor],
  );
  if (!claim.rows.length) {
    const incumbent = (await db.query("SELECT owner FROM app_maintenance WHERE id='main'")).rows[0]
      ?.owner;
    if (!incumbent) return true;
    const previous = getRun(incumbent);
    if (
      (await previous.exists) &&
      !['failed', 'cancelled', 'completed'].includes(await previous.status)
    )
      return false;
    await db.query("DELETE FROM app_maintenance WHERE id='main' AND owner=$1", [incumbent]);
    return maintain(actor);
  }
  for (const run of await state.active()) {
    const execution = getRun(run.workflowId);
    if (
      !(await execution.exists) ||
      ['failed', 'cancelled', 'completed'].includes(await execution.status)
    )
      await interruptRun(run.id);
  }
  for (const run of await state.queued())
    if (!run.workflowId) await start(contentRunWorkflow, [run.id]);
  const lastPoll = await state.effect('storyboard:last-poll');
  if (
    config.pipeline.storyboardPollMs > 0 &&
    (!lastPoll || Date.now() - lastPoll >= config.pipeline.storyboardPollMs)
  ) {
    const c = cloudContext().clients('maintenance');
    const scripts = await c.airtable.searchScripts("{status} = 'Approved'");
    for (const script of scripts.slice(0, 50)) {
      const ref = script.fields.Projects;
      const project = Array.isArray(ref)
        ? await c.airtable.getProject(ref[0])
        : await c.airtable.findProjectByKey(ref);
      if (!project) continue;
      try {
        assertProjectActive(project);
      } catch {
        continue;
      }
      const run = await state.create(
        { projectId: project.id, mode: 'selected', ideaIds: [script.id] },
        { type: 'STORYBOARD', source: 'APPROVAL', occurrence: 'storyboard:' + script.id },
      );
      if (run?.status === 'QUEUED' && !run.workflowId) await start(contentRunWorkflow, [run.id]);
    }
    await state.replaceEffect('storyboard:last-poll', Date.now());
  }
  await db.query('DELETE FROM app_sessions WHERE expires_at<=now()');
  await db.query('DELETE FROM app_rate_limits WHERE reset_at<now()');

  return true;
}
