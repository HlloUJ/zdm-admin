import assert from 'node:assert/strict';
import { createOwnedRunner } from './task-resource-runner.mjs';
import { schedulerNotices } from './task-resource-event-link.mjs';
// Persistent process proof is separate from notification delivery. This does not install a service,
// adopt a saved PID, or treat a scheduler admission as a spawn.
export function createStartedRunner({ store, outbox, resolveTask, runnerOptions, now = Date.now }) {
  let state = store.read();
  state.startedRuns ??= {};
  state.startEvents ??= [];
  const save = (next) => {
    store.write(next);
    state = next;
  };
  const exportStarts = () => {
    const jobs = state.startEvents.map((e) => ({ id: e.job, status: 'running' }));
    let added = 0;
    for (const notice of schedulerNotices({ events: state.startEvents, jobs }, resolveTask))
      if (outbox.enqueue(notice)) added++;
    return { added };
  };
  let activeSpec;
  const runner = createOwnedRunner({
    ...runnerOptions,
    saveIntent(intent) {
      const spec = activeSpec;
      assert.ok(spec && spec.id === intent.id && spec.task && spec.stage);
      assert.ok(
        !Object.values(state.startedRuns).some((r) => r.id === spec.id && r.status !== 'ended'),
        'Unreconciled earlier process; refuse restart',
      );
      const next = structuredClone(state);
      next.startedRuns[intent.runToken] = { ...intent, task: spec.task, stage: spec.stage, status: 'launch-intent' };
      save(next);
    },
    saveIdentity(identity) {
      const previous = state.startedRuns[identity.runToken];
      assert.ok(previous && previous.id === identity.id && previous.status === 'launch-intent');
      assert.equal(previous.fingerprint, identity.fingerprint);
      assert.ok(
        Number.isSafeInteger(identity.pid) && identity.pid > 1 && identity.pgid === identity.pid && identity.startTime,
      );
      const next = structuredClone(state);
      next.startedRuns[identity.runToken] = { ...previous, ...identity, status: 'started' };
      next.startEvents.push({
        id: next.startEvents.length + 1,
        job: identity.runToken,
        task: previous.task,
        stage: previous.stage,
        from: 'queued',
        to: 'running',
        reason: 'Owned process spawn and identity verified',
        at: now(),
        executionStarted: true,
        runToken: identity.runToken,
      });
      save(next);
    },
  });
  let launching = false;
  return {
    async start(spec) {
      assert.equal(launching, false, 'Concurrent launch handshake refused');
      launching = true;
      activeSpec = structuredClone(spec);
      let handle;
      try {
        handle = await runner.start(spec);
      } finally {
        launching = false;
        activeSpec = undefined;
      }
      let notificationExport;
      try {
        notificationExport = exportStarts();
      } catch (error) {
        notificationExport = { pendingError: error.message };
      }
      return {
        ...handle,
        notificationExport,
        completion: handle.completion.then((result) => {
          // Exited leader alone is insufficient proof that the whole group released its reservation.
          if (result.processesEnded) {
            const next = structuredClone(state);
            next.startedRuns[result.runToken].status = 'ended';
            next.startedRuns[result.runToken].result = result;
            save(next);
          }
          return result;
        }),
      };
    },
    stop: (id, runToken) => runner.stop(id, runToken),
    exportStarts,
    snapshot: () => structuredClone(state),
  };
}
