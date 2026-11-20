import assert from 'node:assert/strict';

export const TASK_ACTIONS = Object.freeze(['development', 'preparation', 'combination', 'runtime', 'final']);
const EVIDENCE = ['source', 'runtime', 'delivery'];

export function validateActionDependencies(task) {
  const dependencies = task.actionDependencies ?? [];
  assert.ok(Array.isArray(dependencies), 'Action dependencies must be a list');
  const keys = new Set();
  for (const dependency of dependencies) {
    assert.ok(dependency && typeof dependency === 'object', 'Invalid action dependency');
    assert.match(dependency.task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Exact dependency task required');
    assert.notEqual(dependency.task, task.id, 'Task cannot depend on itself');
    assert.ok(EVIDENCE.includes(dependency.evidence), 'Unknown dependency evidence');
    assert.ok(Array.isArray(dependency.actions) && dependency.actions.length, 'Explicit affected actions required');
    assert.equal(new Set(dependency.actions).size, dependency.actions.length);
    for (const action of dependency.actions) {
      assert.ok(TASK_ACTIONS.includes(action), 'Unknown affected action');
      assert.ok(
        dependency.evidence !== 'runtime' || ['runtime', 'combination', 'final'].includes(action),
        'Runtime dependency must name an action using the runtime',
      );
      const key = [dependency.task, action, dependency.evidence].join(':');
      assert.ok(!keys.has(key), 'Duplicate evidence for one action');
      keys.add(key);
    }
    if (dependency.evidence !== 'delivery')
      assert.match(dependency.head, /^[a-f0-9]{40}$/, 'Pin exact dependency source');
  }
  return dependencies;
}

export function collectActionDependencies(task, action, readers) {
  assert.ok(TASK_ACTIONS.includes(action), 'Exact task action required');
  const requirements = validateActionDependencies(task).filter((item) => item.actions.includes(action));
  const legacy = (task.dependsOn ?? []).map((id) => ({ task: id, evidence: 'delivery' }));
  const seen = new Set();
  const dependencies = [...legacy, ...requirements].flatMap(({ task: id, evidence, head }) => {
    const key = [id, evidence, head].join(':');
    if (seen.has(key)) return [];
    seen.add(key);
    const dependency = { task: id, evidence, ...(head ? { head } : {}) };
    try {
      const proof = readers[evidence]?.(dependency, task, action);
      assert.ok(proof && typeof proof === 'object' && !(proof instanceof Promise), 'Required evidence is unavailable');
      return [{ ...dependency, ready: true, proof }];
    } catch (error) {
      return [{ ...dependency, ready: false, reason: error.message }];
    }
  });
  return { action, ready: dependencies.every((item) => item.ready), dependencies };
}

export function requireActionDependencies(report) {
  const blocked = report.dependencies.find((item) => !item.ready);
  assert.ok(!blocked, `Task action ${report.action} waits for ${blocked?.task}: ${blocked?.reason}`);
  return true;
}
