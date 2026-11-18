import assert from 'node:assert/strict';
import path from 'node:path';
import { readTaskCoordination } from '../task-coordination.mjs';
import { scopedAdmissions } from '../task-execution-scope.mjs';
import { verifyDevelopmentCompletion } from '../task-execution-order-cli.mjs';
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
    const tickets = state.tickets.filter((item) => item.task === task410);
    const ticket = tickets.find((item) => item.lane === 'development');
    const scopes = scopedAdmissions(state).filter((item) => item.task === task410);
    const originalBinding = (event) => event.action === 'bind-native-worker' && event.task === task410;
    const originalDirection = (event) =>
      event.action === 'resume-selected' && event.members?.some((member) => member.task === task410);
    const developmentCompleted = (event) =>
      event.action === 'complete' && event.task === task410 && event.lane === 'development';
    return {
      coordinator: readTaskCoordination(commonDir),
      intake: readRecord('task-board-intake'),
      binding: readRecord('task-thread-titles', 'tasks'),
      registry: registry.resolve({ id: task410 }),
      start: readRecord('task-registry', 'start-intents'),
      queue: {
        revision: state.revision,
        paused: state.paused,
        ticket,
        scope: scopes.find((scope) => scope.lane === 'development'),
        pauseFences: state.events.filter((event) => ['initialize', 'pause-all'].includes(event.action)),
        bindingEvent: state.events.find(originalBinding),
        direction: state.events.findLast(originalDirection),
        ...(ticket?.status === 'completed'
          ? {
              completed: {
                scopes,
                otherTickets: tickets.filter((item) => item !== ticket),
                reservations: (state.dynamicDecisions ?? []).filter(
                  (item) => item.input.task === task410 && ['reserved', 'consumed'].includes(item.status),
                ),
                history: state.events.filter(
                  (event) => originalBinding(event) || originalDirection(event) || developmentCompleted(event),
                ),
              },
            }
          : {}),
      },
    };
  }
  const verifyCompletion = ({ registry: target, queue: { ticket } }) => {
    if (ticket.status === 'completed')
      assert.equal(verifyDevelopmentCompletion(target, ticket.completion.evidence), true);
  };
  const local = readLocal();
  const source = { root, worker, ...local };
  validateInitialPauseSource(source, commonDir);
  verifyCompletion(local);
  const { nativeObservations: observations } = await host.readCreationProgress(
    task410,
    pending.pending.map((entry) => entry.receipt_id),
  );
  const board = await host.readTask(task410);
  const checkedAt = new Date(now()).toISOString();
  const recheck = () => {
    const current = readLocal();
    assert.deepEqual(current, local, '410 source changed during correction; retain the outbox');
    verifyCompletion(current);
  };
  return host.queue.guard(() =>
    box.retire410InitialPause(raw, { clientTransport, source, board, observations, checkedAt }, recheck),
  );
}
