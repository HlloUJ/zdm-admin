import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTaskRegistry, registeredTaskWorktrees } from './task-registry.mjs';
import { probeOwner, continueVerifiedTask } from './task-continuity.mjs';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function read(file) {
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    assert.ok(!lstatSync(p).isSymbolicLink(), 'Linked CI recovery input');
    if (p === path.dirname(p)) break;
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function assessCiContinuation({
  intent,
  task,
  session,
  currentOwner,
  currentHead,
  clean,
  remote,
  resourcesEnded,
}) {
  const reasons = [];
  if (intent.mode !== 'wait-existing-ci' || !/^\d+$/.test(String(intent.runId)))
    reasons.push('Only existing CI wait is supported');
  if (task?.id !== intent.task || currentOwner !== task?.owner || intent.owner !== task?.owner)
    reasons.push('Original owner required');
  if (task?.recordedHead !== intent.head || currentHead !== intent.head || !clean) reasons.push('Candidate changed');
  if (!task?.frozen || task.compatibility?.readOnly || task.previewOnly || task.stage === 'closed')
    reasons.push('Unsupported task state');
  if (session?.batch !== intent.task || session?.startedAt == null || !Array.isArray(session?.events))
    reasons.push('Formal session missing');
  if ((session?.pauses ?? []).some((p) => p.finishedAt == null)) reasons.push('Explicit pause');
  const running = (session?.events ?? []).filter((e) => e.status === 'running');
  if (running.length !== 1 || running[0].name !== 'ci' || running[0].key !== `${intent.head}:${intent.runId}`)
    reasons.push('No exact interrupted CI stage');
  if ((session?.events ?? []).some((e) => e.status === 'failure'))
    reasons.push('Existing failure needs original diagnosis');
  if (
    remote?.headSha !== intent.head ||
    String(remote?.databaseId) !== String(intent.runId) ||
    remote?.event !== 'pull_request'
  )
    reasons.push('Remote run identity differs');
  if (!resourcesEnded) reasons.push('Original process/resource proof incomplete');
  return { ready: reasons.length === 0, reasons };
}

// Narrow first production adapter: resume observing an already-created PR CI, never create/retry
// CI, merge a PR, replay a shell command or continue a data-mutating stage. Other stages stay blocked.
export function createCiContinuation(root, { owner = process.env.CODEX_THREAD_ID, execute = execFileSync } = {}) {
  const registry = createTaskRegistry(root);
  function inspect(intent) {
    const task = registry.readTask(intent.task);
    assert.ok(task, 'Unknown task');
    registry.validateLive(task);
    const directory = path.join(registry.commonDir, 'task-delivery', task.id);
    const session = read(path.join(directory, 'completion-session.json'));
    let resourcesEnded = true;
    const active = session.events.filter((e) => e.status === 'running');
    for (const event of active) {
      if (probeOwner(event.owner) !== 'absent' || event.processTracking !== 1 || !Array.isArray(event.processes))
        resourcesEnded = false;
      for (const process of event.processes ?? []) {
        assert.match(process.token, /^[a-f0-9-]{36}$/);
        const journal = read(path.join(directory, 'process-' + process.token + '.json'));
        if (
          journal.token !== process.token ||
          journal.host !== os.hostname() ||
          !Number.isSafeInteger(journal.pgid) ||
          journal.pgid <= 1 ||
          !['started', 'exited', 'quiescent'].includes(journal.status)
        ) {
          resourcesEnded = false;
          continue;
        }
        try {
          globalThis.process.kill(-journal.pgid, 0);
          resourcesEnded = false;
        } catch (error) {
          if (error.code !== 'ESRCH') resourcesEnded = false;
        }
      }
    }
    const remote = JSON.parse(
      execute('gh', ['run', 'view', String(intent.runId), '--json', 'databaseId,headSha,event,status,conclusion'], {
        cwd: task.worktree,
        encoding: 'utf8',
        timeout: 15000,
      }),
    );
    const assessment = assessCiContinuation({
      intent,
      task,
      session,
      currentOwner: owner,
      currentHead: git(task.worktree, 'rev-parse', 'HEAD'),
      clean: git(task.worktree, 'status', '--porcelain') === '',
      remote,
      resourcesEnded,
    });
    return {
      ...intent,
      ...assessment,
      supported: true,
      runnerAbsent: resourcesEnded,
      resourcesResolved: resourcesEnded,
      effectsReconciled: assessment.ready,
      candidateUnchanged: assessment.ready,
      paused: !assessment.ready,
      requiresConfirmation: false,
      observedAt: Date.now(),
    };
  }
  async function executeOriginal(intent) {
    assert.equal(inspect(intent).ready, true, 'State changed before original entry');
    const task = registry.readTask(intent.task);
    const mains = registeredTaskWorktrees(root).filter((w) => w.branch === 'main');
    assert.equal(mains.length, 1);
    const main = realpathSync(mains[0].worktree);
    assert.equal(git(main, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'origin/main'));
    assert.equal(git(main, 'status', '--porcelain'), '');
    const entry = path.join(main, 'scripts/task-entry.mjs');
    assert.ok(existsSync(entry));
    execute(
      process.execPath,
      [entry, '--worktree', task.worktree, 'complete', 'wait', String(intent.runId), intent.head],
      { cwd: main, stdio: 'inherit' },
    );
    return { status: 'original-wait-returned', task: intent.task, runId: intent.runId, head: intent.head };
  }
  return { inspect, run: (intent, directory) => continueVerifiedTask({ intent, directory, inspect, executeOriginal }) };
}
