import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readActiveBatch } from './task-batch.mjs';
import {
  bindBatchTiming,
  readTimeline,
  refreshTimeline,
  ensureObserver,
  timingDirectory,
  recordValidationTiming,
} from './batch-timing-store.mjs';
import { assertTimingReady } from './batch-timing-core.mjs';

export function timingCommon(root) {
  const value = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  assert.equal(value.status, 0, 'Batch timing repository unavailable');
  return path.resolve(root, value.stdout.trim());
}
export function refreshCurrentTiming(root, { env = process.env, bind = false, resume = false } = {}) {
  if (env.CI || env.GITHUB_ACTIONS === 'true') return { status: 'not-required' };
  const batch = readActiveBatch(root);
  if (!batch) return { status: 'no-active-batch' };
  if (bind) return bindBatchTiming(root, batch, { env, resume });
  const common = batch.repository.commonDir,
    state = readTimeline(common, batch.id);
  if (!state)
    return {
      status: 'legacy-no-batch-timing',
      reason: 'No authorization boundary was captured; do not claim whole-task timing.',
    };
  if (env.CODEX_THREAD_ID)
    assert.ok(
      state.sources.some((s) => s.thread === env.CODEX_THREAD_ID),
      'Timing thread not bound; explicitly resume the batch first',
    );
  const result = refreshTimeline(common, batch.id);
  ensureObserver(timingDirectory(common, batch.id));
  return {
    ...result,
    status: result.summary.status,
    file: path.join(timingDirectory(common, batch.id), 'summary.json'),
  };
}
export function requireBatchTiming(common, batch, { now = Date.now(), legacyAllowed = true } = {}) {
  const state = readTimeline(common, batch);
  if (!state) {
    assert.ok(legacyAllowed, 'New batch timing proof missing');
    return { status: 'legacy-no-batch-timing', wallMs: null };
  }
  const result = refreshTimeline(common, batch, { now });
  const summary = assertTimingReady(result.state, { now, completion: result.completion });
  return summary;
}

export function observeValidationTiming(root, attempt, env = process.env) {
  if (env.CI || env.GITHUB_ACTIONS === 'true') return;
  try {
    const batch = readActiveBatch(root);
    if (batch && readTimeline(batch.repository.commonDir, batch.id))
      recordValidationTiming(batch.repository.commonDir, batch.id, attempt);
  } catch (error) {
    console.error('Batch validation timing unavailable: ' + error.message);
  }
}
