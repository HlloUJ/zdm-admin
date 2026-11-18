import assert from 'node:assert/strict';
import path from 'node:path';
import { readTaskCoordination } from '../task-coordination.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';
import { createProgressOutbox } from '../task-progress-outbox.mjs';
import {
  coordinator410,
  correctionTask,
  initialPauseReceipt,
  originalRequest,
  priorityRequest,
  readPrivateCorrectionFile,
  task410,
  validate410ClientTransport,
  validateInitialPauseOutbox,
  validateInitialPauseSource,
  worker410,
} from './task-410-initial-pause-evidence.mjs';

export async function correct410InitialPause(input, host, registry, { now = Date.now } = {}) {
  const { clientTransport, ...target } = input;
  assert.deepEqual(target, { taskId: task410, receiptId: initialPauseReceipt });
  assert.equal(process.env.CODEX_THREAD_ID, coordinator410, 'Actual 410 coordinator runtime required');
  const commonDir = registry.commonDir;
  assert.equal(host.queue.commonDir, commonDir);
  assert.equal(readTaskCoordination(commonDir)?.current.rootThreadId, coordinator410);
  assert.equal(await host.dependenciesReady({ dependsOn: [correctionTask] }), true, '039 formal closure required');

  const directory = path.join(commonDir, 'task-progress', task410);
  const box = createProgressOutbox(directory);
  const prior = box.readInitialPauseRetirement();
  if (prior) return { ...prior, replay: true };
  const raw = readPrivateCorrectionFile(path.join(directory, 'outbox.json'));
  const pending = JSON.parse(raw);
  validateInitialPauseOutbox(pending);
  validate410ClientTransport(raw, clientTransport);

  const selectNative = async (id, include) => {
    const { thread, turns } = await host.readThread(id);
    const { title, hostId, status, cwd } = thread;
    return {
      thread: { id: thread.id, title, hostId, status, cwd },
      turns: turns.map((turn) => ({ items: turn.items.filter(include) })).filter((turn) => turn.items.length),
    };
  };
  const [root, worker] = await Promise.all([
    selectNative(coordinator410, (item) => [originalRequest, priorityRequest].includes(item.id)),
    selectNative(worker410, (item) => item.name === 'create_thread' && item.namespace === 'codex_app'),
  ]);
  function readLocal() {
    const readRecord = (...paths) =>
      JSON.parse(readPrivateCorrectionFile(path.join(commonDir, ...paths, task410 + '.json')));
    const state = host.queue.read();
    return {
      coordinator: readTaskCoordination(commonDir),
      intake: readRecord('task-board-intake'),
      binding: readRecord('task-thread-titles', 'tasks'),
      registry: registry.resolve({ id: task410 }),
      start: readRecord('task-registry', 'start-intents'),
      queue: {
        revision: state.revision,
        paused: state.paused,
        ticket: state.tickets.find((ticket) => ticket.task === task410 && ticket.lane === 'development'),
        scope: scopedAdmissions(state).find((scope) => scope.task === task410 && scope.lane === 'development'),
        pauseFences: state.events.filter((event) => ['initialize', 'pause-all'].includes(event.action)),
        bindingEvent: state.events.find((event) => event.action === 'bind-native-worker' && event.task === task410),
        direction: state.events.findLast(
          (event) => event.action === 'resume-selected' && event.members?.some((member) => member.task === task410),
        ),
      },
    };
  }
  const local = readLocal();
  const source = { root, worker, ...local };
  validateInitialPauseSource(source, commonDir);
  const { nativeObservations: observations } = await host.readCreationProgress(
    task410,
    pending.pending.map((entry) => entry.receipt_id),
  );
  const board = await host.readTask(task410);
  const checkedAt = new Date(now()).toISOString();
  const recheck = () => assert.deepEqual(readLocal(), local, '410 source changed during correction; retain the outbox');
  return host.queue.guard(() =>
    box.retire410InitialPause(raw, { clientTransport, source, board, observations, checkedAt }, recheck),
  );
}
