import assert from 'node:assert/strict';
import { requireTaskCoordinator, readTaskCoordination } from './task-coordination.mjs';
import { taskExecutor, taskMonitoring } from './task-execution-binding.mjs';
import { capacityReleaseProof } from './task-capacity-release.mjs';
import { continuationPlan } from './task-continuation-plan.mjs';
import { coordinationDigest, planNextActions } from './task-coordination-next.mjs';

export const CONTINUATION_HOST_ACTIONS = Object.freeze([
  'continuation-plan',
  'coordination-plan',
  'coordination-observe',
  'coordination-record',
  'capacity-release',
]);

const eligibleBoard = (board, id) =>
  board?.id === id && !board.deleted_at && ['active', 'review', 'merging'].includes(board.status);

export async function continuationHostAction(action, input, host, { registry, root, observe }) {
  const { queue } = host;
  const coordinator = input.coordinatorThreadId;
  const route = readTaskCoordination(registry.commonDir);
  assert.ok(route, 'An appointed current coordinator is required');
  requireTaskCoordinator(registry.commonDir, coordinator);
  assert.equal(process.env.CODEX_THREAD_ID, coordinator, 'Actual current coordinator runtime required');
  const native = await host.readThread(coordinator);
  assert.equal(native?.thread?.id, coordinator, 'Exact current coordinator native readback required');
  assert.equal(native.thread.hostId, 'local');
  assert.deepEqual(readTaskCoordination(registry.commonDir), route, 'Coordinator changed during readback');
  const state = queue.read();
  const grant = state?.dynamicAuthorities?.find((item) => item.id === input.authorityId);
  function grantIsCurrent(ledger) {
    assert.ok(grant, 'An existing standing delegation is required');
    assert.equal(grant.request.authorId, route.current.request.authorId);
    assert.deepEqual(
      ledger.dynamicAuthorities.find((item) => item.id === grant.id),
      grant,
    );
    const lastPause = Math.max(
      0,
      ...ledger.events.filter((event) => event.action === 'pause-all').map((event) => event.request.sequence),
    );
    assert.ok(grant.request.sequence > lastPause, 'Standing delegation revoked by a later pause');
    assert.deepEqual(readTaskCoordination(registry.commonDir), route, 'Coordinator changed during the action');
  }
  function member(id) {
    const task = registry.resolve({ id });
    assert.ok(
      grant.source.tasks.some((item) => item.task === id && item.owner === task.owner),
      'Action is outside the preserved user delegation',
    );
    return task;
  }
  if (action === 'continuation-plan') return continuationPlan(root, input.task);
  grantIsCurrent(state);

  if (action === 'coordination-plan') {
    const candidates = [];
    const omitted = [];
    const enrollment = [];
    const busyResources = new Set();
    let finalHeld = false;
    for (const ticket of state.tickets) {
      if (!['running', 'blocked'].includes(ticket.status)) continue;
      const scope = [state.scopedAdmission, ...(state.scopedAdmissions ?? [])].find(
        (item) => item?.task === ticket.task && item.lane === ticket.lane,
      );
      if (ticket.status === 'running') busyResources.add('task:' + ticket.task);
      if (ticket.lane === 'delivery' && scope?.phase !== 'preparation') finalHeld = true;
    }
    for (const entry of grant.source.tasks) {
      try {
        const task = member(entry.task);
        const id = taskMonitoring(task)?.taskStableId ?? task.id;
        const board = await host.readTask(id);
        if (!eligibleBoard(board, id)) {
          omitted.push({ task: task.id, reason: 'Board task paused, terminal or unknown' });
          continue;
        }
        const plan = continuationPlan(root, task.id);
        const development = state.tickets.find((ticket) => ticket.task === task.id && ticket.lane === 'development');
        const preparation = plan.actions.find((item) => item.action === 'preparation');
        const worker = await host.readThread(taskExecutor(task));
        const workerIdle =
          worker?.thread?.id === taskExecutor(task) && ['idle', 'error'].includes(worker.thread.status?.type);
        if (
          workerIdle &&
          development?.status === 'completed' &&
          development.completion?.digest &&
          !preparation.ticket &&
          (task.frozen || ['review', 'merging'].includes(board.status))
        ) {
          enrollment.push({
            task: task.id,
            executor: taskExecutor(task),
            action: 'delivery-enroll',
            developmentEvidenceDigest: development.completion.digest,
            reasons: preparation.reasons.filter((reason) => reason !== 'Missing delivery phase ticket'),
          });
        }
        for (const report of plan.actions.filter((item) =>
          ['development', 'preparation', 'final'].includes(item.action),
        )) {
          if (!report.ticket || ['completed', 'cancelled'].includes(report.ticket.status)) continue;
          if (report.action === 'development' && board.status !== 'active') continue;
          candidates.push({
            task: task.id,
            executor: taskExecutor(task),
            action: report.action,
            order: state.tickets.find((item) => item.lane === report.ticket.lane && item.task === task.id).request
              .sequence,
            resources: ['task:' + task.id],
            dependencies: report.dependencies.map((item) => ({
              ...item,
              unlockAction:
                item.evidence === 'delivery' ? 'final' : item.evidence === 'source' ? 'development' : 'runtime',
            })),
            waitReason: workerIdle ? report.reasons.join(' / ') : 'Original executor is active or unknown',
          });
        }
      } catch (error) {
        omitted.push({ task: entry.task, reason: error.message });
      }
    }
    const capacity = await host.readCapacity();
    const observed = [
      capacity.activeDevelopment,
      capacity.activePreparation ?? 0,
      capacity.activeDelivery,
      capacity.activeOther,
    ];
    assert.ok(
      Number.isSafeInteger(capacity.limit) &&
        capacity.limit > 0 &&
        observed.every((value) => Number.isSafeInteger(value) && value >= 0) &&
        capacity.activeDelivery <= 1,
      'Verified scheduling capacity required',
    );
    const reservations = (state.dynamicDecisions ?? []).filter((item) => item.status === 'reserved');
    const creations = state.tickets.filter((item) => item.status === 'queued' && item.nativeLaunchReserved).length;
    for (const decision of reservations) busyResources.add('task:' + decision.input.task);
    finalHeld ||= capacity.activeDelivery > 0 || reservations.some((item) => item.input.phase === 'final');
    const plan = planNextActions(candidates, {
      free: Math.max(
        0,
        capacity.limit - observed.reduce((sum, value) => sum + value, 0) - reservations.length - creations,
      ),
      busyResources: [...busyResources],
      finalHeld,
    });
    assert.deepEqual(queue.read(), state, 'Queue changed while preparing coordination plan');
    grantIsCurrent(state);
    const handled = new Set(
      state.events.filter((item) => item.action === 'coordinator-next-action').map((item) => item.sourceDigest),
    );
    const pending = state.events.flatMap((event, sourceIndex) => {
      if (!grant.source.tasks.some((member) => member.task === event.task)) return [];
      if (
        ![
          'block',
          'complete',
          'preparation-finished',
          'capacity-released',
          'coordinator-observation',
          'delivery-phase-enrolled',
        ].includes(event.action)
      )
        return [];
      return handled.has(coordinationDigest({ sourceIndex, source: event }))
        ? []
        : [{ sourceIndex, task: event.task, event: event.action }];
    });
    return {
      revision: state.revision,
      authorityId: grant.id,
      pending,
      omitted,
      enrollment,
      ...plan,
      startAuthorized: false,
    };
  }
  if (action === 'coordination-record') {
    const event = state.events[input.sourceIndex];
    assert.ok(event?.task, 'Exact coordination source task required');
    member(event.task);
    return queue.recordNextAction(
      {
        sourceIndex: input.sourceIndex,
        outcome: input.outcome,
        coordinator,
        expectedQueueRevision: input.expectedQueueRevision,
      },
      grantIsCurrent,
    );
  }
  const task = member(input.task);
  const id = taskMonitoring(task)?.taskStableId ?? task.id;
  const board = await host.readTask(id);
  assert.ok(eligibleBoard(board, id), 'Paused or terminal task cannot change orchestration state');
  if (action === 'coordination-observe') {
    const report = continuationPlan(root, task.id);
    const observation = {
      candidate: report.source.value?.head ?? null,
      dependencies: report.actions.map((item) => ({
        action: item.action,
        dependencies: item.dependencies.map(({ task, evidence, head, ready }) => ({ task, evidence, head, ready })),
      })),
      resources: report.resources.value ?? null,
      runtimeRestricted: report.environment.value?.runtimeBlocked ?? null,
    };
    return queue.recordCoordinationObservation(
      {
        task: task.id,
        observation: JSON.parse(JSON.stringify(observation)),
        coordinator,
        expectedQueueRevision: input.expectedQueueRevision,
      },
      (fresh) => {
        grantIsCurrent(fresh);
        assert.deepEqual(registry.readTask(task.id), task, 'Task changed during coordination observation');
      },
    );
  }

  const worker = await host.readThread(taskExecutor(task));
  assert.equal(worker?.thread?.id, taskExecutor(task));
  assert.equal(worker.thread.hostId, native.thread.hostId);
  assert.ok(['idle', 'error'].includes(worker.thread.status?.type), 'Worker must be proven idle');
  if (input.recovery?.kind === 'dependency') {
    const action = continuationPlan(root, task.id).actions.find((item) => item.action === input.nextAction);
    assert.ok(
      action?.dependencies.some((item) => item.task === input.recovery.task && !item.ready),
      'Release must preserve the actual blocked dependency',
    );
  }
  return queue.releaseCapacity(
    {
      task: task.id,
      lane: input.lane,
      owner: task.owner,
      admission: input.admission,
      action: input.nextAction,
      recovery: input.recovery,
      expectedQueueRevision: input.expectedQueueRevision,
    },
    (ticket, { replay }) => {
      grantIsCurrent(queue.read());
      assert.deepEqual(registry.readTask(task.id), task);
      if (replay) return null;
      return { ...capacityReleaseProof(registry, ticket, task, { observe }), coordinator };
    },
  );
}
