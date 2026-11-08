import assert from 'node:assert/strict';
export const PREVIEW_ROLES = Object.freeze({
  integration: 5173,
  tests: 5174,
  development: 5175,
  managedUpstream: 5176,
  temporaryMin: 5177,
  temporaryMax: 5199,
});
const SHA = /^[a-f0-9]{40}$/;
export function assertDevelopmentApi(origin) {
  const url = new URL(origin);
  assert.ok(
    url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash,
    'Unknown development API origin',
  );
  const port = Number(url.port);
  assert.ok(port >= 8081 && port <= 8099, 'Development preview cannot use integration API or an unallocated backend');
  return url.origin;
}
export function previewDescriptor(role, input) {
  if (role === 'integration') {
    assert.match(input.main, SHA);
    assert.equal(input.source, 'published-main', 'Integration only accepts published main');
    return {
      role,
      port: PREVIEW_ROLES.integration,
      source: 'published-main',
      main: input.main,
      acceptsUnfinishedTasks: false,
    };
  }
  if (role === 'development') {
    assert.ok(input.task?.id && input.task.worktree && input.task.branch, 'Exact task identity required');
    assert.ok(
      input.task.stage !== 'closed' && !input.task.compatibility?.readOnly,
      'Task cannot own a development preview',
    );
    return {
      role,
      port: PREVIEW_ROLES.development,
      task: input.task.id,
      branch: input.task.branch,
      worktree: input.task.worktree,
      api: input.api ? assertDevelopmentApi(input.api) : null,
      readiness: 'requires-runtime-proof',
      requiredChecks: ['source-identity', 'frontend-ready', 'api-up', 'data-binding', 'resource-ownership'],
    };
  }
  assert.ok(['temporary', 'combination'].includes(role), 'Unknown preview role');
  assert.ok(
    Number.isInteger(input.port) &&
      input.port >= PREVIEW_ROLES.temporaryMin &&
      input.port <= PREVIEW_ROLES.temporaryMax,
    'Temporary preview must use an allocated temporary port',
  );
  if (role === 'combination') {
    assert.ok(Array.isArray(input.members) && input.members.length > 1, 'Combination requires explicit task members');
    const ids = new Set();
    for (const member of input.members) {
      assert.ok(member.task && !ids.has(member.task), 'Duplicate or absent combination task');
      ids.add(member.task);
      assert.match(member.commit, SHA);
    }
    return {
      role,
      port: input.port,
      members: input.members.map((x) => ({ task: x.task, commit: x.commit })),
      eligibleForTaskDelivery: false,
      requiredChecks: ['source-manifest', 'combination-conflicts', 'runtime-compatibility', 'data-isolation'],
    };
  }
  assert.ok(input.task?.id, 'Exact task identity required');
  return {
    role,
    port: input.port,
    task: input.task.id,
    eligibleForTaskDelivery: false,
    readiness: 'requires-runtime-proof',
  };
}
