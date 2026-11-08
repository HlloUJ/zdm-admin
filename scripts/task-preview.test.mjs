import assert from 'node:assert/strict';
import test from 'node:test';
import { taskPreview } from './task-preview.mjs';
const task = { id: 'a', owner: 'chat-a', worktree: '/repo/a', branch: 'codex/a', stage: 'developing' };
function system() {
  const requests = [];
  const status = {
    type: 'zdm-task-preview-service',
    taskSelectionProtocol: 2,
    phase: 'running',
    worktree: '/repo/b',
    servicePid: 3,
    childPid: 4,
    selectionRevision: 5,
  };
  return {
    requests,
    status,
    dependencies: {
      owner: 'chat-a',
      registry: () => ({ resolve: () => task }),
      readStatus: async () => status,
      request: async (r) => {
        requests.push(r);
        return { status: { phase: 'running', worktree: task.worktree }, interruption: true };
      },
    },
  };
}
test('switch requests exact task, chat and current service ownership without stopping the other task in the client', async () => {
  const f = system();
  await taskPreview('/repo/a', ['switch'], f.dependencies);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].requestPath, '/select-task');
  assert.deepEqual(f.requests[0].payload.expected, {
    worktree: '/repo/b',
    childPid: 4,
    servicePid: 3,
    selectionRevision: 5,
  });
  assert.equal(f.requests[0].payload.task, 'a');
});
test('wrong chat, offline service, or old runtime cannot take over the existing preview', async () => {
  for (const option of ['owner', 'offline', 'protocol']) {
    const f = system();
    if (option === 'owner') f.dependencies.owner = 'chat-b';
    if (option === 'offline') f.status.phase = 'offline';
    if (option === 'protocol') delete f.status.taskSelectionProtocol;
    await assert.rejects(taskPreview('/repo/a', ['switch'], f.dependencies));
    assert.equal(f.requests.length, 0);
  }
});
test('role mapping is read-only and never requires a registry or starts services', async () => {
  const roles = await taskPreview('/repo', ['roles'], {
    registry: () => assert.fail('no registry lookup'),
    request: () => assert.fail('no runtime action'),
  });
  assert.equal(roles.integration, 5173);
  assert.equal(roles.development, 5175);
});
