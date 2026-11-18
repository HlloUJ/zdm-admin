import assert from 'node:assert/strict';

// Registry/queue/source owners are historical provenance. Never rewrite them to
// impersonate the executor. Only this separately recorded binding grants access.
export function executionBinding(task) {
  const history = task.executionBindings;
  if (history === undefined) return null;
  assert.ok(Array.isArray(history) && history.length, 'Invalid execution binding history');
  let previous = task.owner;
  for (const [index, binding] of history.entries()) {
    assert.equal(binding.version, 1);
    assert.equal(binding.revision, index + 1);
    assert.equal(binding.taskId, task.id);
    assert.equal(binding.previousExecutor, previous);
    assert.equal(binding.historicalOwner, task.owner);
    assert.equal(binding.worktree, task.worktree);
    assert.equal(binding.branch, task.branch);
    assert.equal(binding.commonDir, task.repository.commonDir);
    assert.ok(binding.executor && binding.coordinator && binding.request?.messageId);
    for (const key of ['executor', 'coordinator'])
      assert.match(binding[key], /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.ok(
      binding.request.roomId &&
        binding.request.authorId &&
        Number.isSafeInteger(binding.request.sequence) &&
        binding.request.sequence > 0,
    );
    assert.match(binding.quiescenceDigest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(binding.boundAt)));
    assert.equal(binding.monitoring.worker, binding.executor);
    assert.equal(binding.monitoring.rootThreadId, binding.coordinator);
    assert.equal(binding.monitoring.roomId, binding.request.roomId);
    assert.equal(binding.monitoring.authorizationRef, binding.request.messageId);
    if (binding.boardTaskId !== undefined) assert.equal(binding.monitoring.taskStableId, binding.boardTaskId);
    previous = binding.executor;
  }
  return history.at(-1);
}
export function taskExecutor(task) {
  return executionBinding(task)?.executor ?? task.owner;
}
export function taskMonitoring(task) {
  return executionBinding(task)?.monitoring ?? task.monitoring;
}
export function assertTaskExecutor(
  task,
  actor = process.env.CODEX_THREAD_ID,
  message = 'Current chat must own this exact task through its current execution binding',
) {
  if (executionBinding(task))
    assert.equal(
      process.env.CODEX_THREAD_ID,
      taskExecutor(task),
      'Real bound executor runtime required; current chat must own this task',
    );
  assert.equal(actor, taskExecutor(task), message);
  return task.owner; // Explicit historical ledger identity for internal queues/leases.
}

function nativeDelegation(snapshot, source, includes) {
  const escaped = includes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const token = new RegExp('(?<![a-zA-Z0-9_-])' + escaped + '(?![a-zA-Z0-9_-])');
  return snapshot.turns
    ?.flatMap((turn) => turn.items ?? [])
    .find((item) => {
      if (!item.id) return false;
      if (
        item.type !== 'functionCallOutput' ||
        item.namespace !== 'codex_app' ||
        item.name !== 'create_thread' ||
        item.output?.truncated !== false
      )
        return false;
      const match = item.output.text?.match(
        /^<codex_delegation>\n {2}<source_thread_id>([^<]+)<\/source_thread_id>\n {2}<input>([\s\S]*)<\/input>\n<\/codex_delegation>$/,
      );
      return match?.[1] === source && token.test(match[2]);
    });
}
// An appointment already accepted into the project ledger can be identified
// from the current chat's original native event without waking its source chat.
export function verifyCoordinatorObservation(snapshot, input) {
  assert.equal(snapshot?.thread?.id, input.rootThreadId, 'Actual current coordinator observation required');
  if (input.rootThreadId === input.request.roomId) {
    const message = snapshot.turns
      ?.flatMap((turn) => turn.items ?? [])
      .find((item) => item.type === 'userMessage' && item.id === input.request.messageId);
    assert.ok(message, 'Stored coordinator appointment message missing');
    return message;
  }
  const creation = nativeDelegation(snapshot, input.request.roomId, input.request.messageId);
  assert.ok(creation, 'Stored coordinator appointment has conflicting native provenance');
  return creation;
}
// Read the real authorization room, even when a new coordinator now dispatches
// it. Cross-room authority needs the original native coordinator creation event.
export async function verifyCoordinatorSource(input, readThread) {
  const source = await readThread(input.request.roomId);
  assert.equal(source.thread.id, input.request.roomId);
  assert.ok(
    source.turns?.some((turn) =>
      turn.items?.some((item) => item.type === 'userMessage' && item.id === input.request.messageId),
    ),
    'Original execution message missing; Actual user execution message must be read from the platform',
  );
  if (input.rootThreadId !== input.request.roomId) {
    const coordinator = await readThread(input.rootThreadId);
    assert.equal(coordinator.thread.id, input.rootThreadId);
    assert.ok(
      nativeDelegation(coordinator, input.request.roomId, input.request.messageId),
      'Cross-coordinator authorization requires the original native creation provenance',
    );
  }
  return source;
}
export function verifyExecutionWorker(snapshot, input, expectedTitle) {
  assert.equal(snapshot.thread.id, input.owner);
  assert.equal(snapshot.thread.title, expectedTitle, 'Exact board title readback required');
  assert.notEqual(input.owner, input.rootThreadId);
  const provenance = nativeDelegation(snapshot, input.rootThreadId, input.taskId);
  assert.ok(provenance, 'Worker must have an original native creation event for this coordinator and task');
  return provenance;
}
