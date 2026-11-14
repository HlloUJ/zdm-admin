import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  lstatSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { initialSchedulerState } from './task-resource-scheduler.mjs';
function noLinks(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    try {
      assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked scheduler storage rejected');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (path.dirname(p) === p) break;
  }
}
// Caller holds this lock for the entire scheduler lifetime, not just individual writes.
// Stale locks fail closed; recovery needs separate process identity proof before removal.
export function openSchedulerStore(directory) {
  noLinks(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'scheduler.lock'),
    file = path.join(directory, 'state.json');
  mkdirSync(lock, { mode: 0o700 });
  const token = randomUUID(),
    owner = path.join(lock, 'owner.json');
  writeFileSync(owner, JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }), { flag: 'wx', mode: 0o600 });
  const owned = () => {
    noLinks(owner);
    assert.equal(JSON.parse(readFileSync(owner)).token, token);
  };
  return {
    read() {
      owned();
      noLinks(file);
      try {
        const s = JSON.parse(readFileSync(file));
        assert.equal(s.version, 1);
        return s;
      } catch (e) {
        if (e.code === 'ENOENT') return initialSchedulerState();
        throw e;
      }
    },
    write(state) {
      owned();
      noLinks(file);
      assert.equal(state.version, 1);
      const tmp = `${file}.${randomUUID()}.tmp`;
      const fd = openSync(tmp, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(state) + '\n');
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, file);
      const parent = openSync(directory, 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    },
    close() {
      owned();
      unlinkSync(owner);
      rmdirSync(lock);
    },
  };
}
