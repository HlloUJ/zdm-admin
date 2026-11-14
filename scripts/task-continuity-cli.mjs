import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync, renameSync, lstatSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { collectTaskContinuity, notifyContinuityChanges } from './task-continuity.mjs';

const args = process.argv.slice(2),
  selected = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--task') {
    const id = args[++index];
    assert.match(id ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    selected.push(id);
  } else
    assert.ok(['--once', '--watch', '--notify'].includes(arg), 'Use --once or --watch [--task exact-id] [--notify]');
}
assert.equal(args.filter((a) => ['--once', '--watch'].includes(a)).length, 1);
assert.ok(!args.includes('--notify') || selected.length, 'Notification requires explicit task scope');
const root = realpathSync(process.cwd());
const directory = path.join(root, '.task-runtime', 'continuity-observer');
for (let p = directory; ; p = path.dirname(p)) {
  if (existsSync(p)) assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked observer state path');
  if (p === path.dirname(p)) break;
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
assert.ok(!lstatSync(directory).isSymbolicLink());
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());
do {
  const observedAt = new Date().toISOString();
  const tasks = collectTaskContinuity(root).filter((task) => !selected.length || selected.includes(task.task));
  const snapshot = { version: 1, observedAt, readOnly: true, automaticResumptionEnabled: false, tasks };
  const temporary = path.join(directory, `snapshot-${randomUUID()}.json`);
  writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path.join(directory, 'latest.json'));
  console.log(JSON.stringify(snapshot));
  if (args.includes('--notify')) await notifyContinuityChanges(tasks, path.join(directory, 'notifications'));
  if (args.includes('--once') || controller.signal.aborted) break;
  try {
    await setTimeout(60_000, null, { signal: controller.signal });
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  }
} while (!controller.signal.aborted);
