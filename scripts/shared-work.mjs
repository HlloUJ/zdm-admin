import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';

function safe(file) {
  if (existsSync(file)) assert.ok(!lstatSync(file).isSymbolicLink(), 'Shared work state must not be a symlink');
}
function resourcesOverlap(a, b) {
  if (a === 'shared' || b === 'shared') return true;
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
function resource(value) {
  assert.ok(typeof value === 'string' && value.length > 0, 'Resource required');
  assert.ok(
    !path.isAbsolute(value) &&
      !value.includes('\\') &&
      !value.split('/').some((part) => ['', '.', '..'].includes(part)),
    'Use canonical relative resource paths',
  );
  return value;
}
export function createSharedWork(directory) {
  const stateFile = path.join(directory, 'workers.json');
  function read() {
    safe(directory);
    safe(stateFile);
    if (!existsSync(stateFile)) return { version: 1, workers: [] };
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(state.version, 1);
    assert.ok(Array.isArray(state.workers));
    for (const worker of state.workers) {
      assert.ok(
        typeof worker.token === 'string' && typeof worker.owner === 'string' && typeof worker.module === 'string',
      );
      assert.ok(Array.isArray(worker.resources) && worker.resources.length);
      worker.resources.forEach(resource);
    }
    return state;
  }
  function mutate(change) {
    safe(directory);
    mkdirSync(directory, { recursive: true });
    const lock = path.join(directory, 'write.lock');
    try {
      mkdirSync(lock);
    } catch {
      throw new Error('Shared work registry is locked; preserve owner state');
    }
    try {
      const state = read();
      const result = change(state);
      const temporary = path.join(directory, randomUUID() + '.tmp');
      try {
        writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, stateFile);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      return result;
    } finally {
      rmdirSync(lock);
    }
  }
  function claim({ owner, module, resources }) {
    assert.ok(
      typeof owner === 'string' && owner.trim() && typeof module === 'string' && module.trim(),
      'Explicit owner and module required',
    );
    assert.ok(Array.isArray(resources) && resources.length, 'Explicit resources required');
    resources = [...new Set(resources.map(resource))];
    return mutate((state) => {
      const conflict = state.workers.find((worker) =>
        worker.resources.some((a) => resources.some((b) => resourcesOverlap(a, b))),
      );
      assert.ok(!conflict, `Resource belongs to another active worker: ${conflict?.owner}; do not take over`);
      const worker = { owner, module, resources, token: randomUUID() };
      state.workers.push(worker);
      return worker;
    });
  }
  function release({ owner, token }) {
    return mutate((state) => {
      const index = state.workers.findIndex((worker) => worker.owner === owner && worker.token === token);
      assert.ok(index >= 0, 'Worker ownership does not match; preserve claims');
      state.workers.splice(index, 1);
    });
  }
  function assertIdle() {
    const state = read();
    assert.equal(state.workers.length, 0, 'Parallel workers remain active; preserve shared preview and worktrees');
  }
  return { read, claim, release, assertIdle };
}
