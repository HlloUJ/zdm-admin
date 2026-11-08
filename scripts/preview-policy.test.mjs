import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDescriptor, assertDevelopmentApi } from './preview-policy.mjs';
const sha = 'a'.repeat(40),
  task = { id: 'a', worktree: '/tasks/a', branch: 'codex/a', stage: 'developing' };
test('fixed integration and selected-task development roles stay distinct', () => {
  assert.equal(previewDescriptor('integration', { main: sha, source: 'published-main' }).port, 5173);
  assert.throws(
    () => previewDescriptor('integration', { main: sha, source: 'unfinished-combination' }),
    /published main/,
  );
  const descriptor = previewDescriptor('development', { task, api: 'http://127.0.0.1:8081' });
  assert.equal(descriptor.port, 5175);
  assert.equal(descriptor.task, 'a');
  assert.equal(descriptor.readiness, 'requires-runtime-proof');
  assert.throws(() => previewDescriptor('development', { task: { ...task, stage: 'closed' } }), /cannot own/);
});
test('development API cannot fall back to integration, unknown origin, or credential URL', () => {
  for (const origin of [
    'http://127.0.0.1:8080',
    'http://127.0.0.1:9000',
    'https://127.0.0.1:8081',
    'http://user:pass@127.0.0.1:8081',
    'http://127.0.0.1:8081/api',
  ])
    assert.throws(() => assertDevelopmentApi(origin));
});
test('temporary and combination previews require explicit port and source versions', () => {
  const descriptor = previewDescriptor('combination', {
    port: 5177,
    members: [
      { task: 'a', commit: sha },
      { task: 'b', commit: 'b'.repeat(40) },
    ],
  });
  assert.equal(descriptor.eligibleForTaskDelivery, false);
  for (const port of [5173, 5174, 5175, 5176, 5200])
    assert.throws(() => previewDescriptor('temporary', { port, task }), /temporary port/);
  assert.throws(
    () =>
      previewDescriptor('combination', {
        port: 5177,
        members: [
          { task: 'a', commit: sha },
          { task: 'a', commit: sha },
        ],
      }),
    /Duplicate/,
  );
});
