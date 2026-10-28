import { readTimingSummary } from './batch-timing-store.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { completionPhase, completionSummary } from './completion-session.mjs';
import { assertCompletionQuality } from './completion-ci-evidence.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const labels = {
  'local-validation': '本地实现与验证阶段，尚未正式交付',
  paused: '人工暂停中',
  'delivery-in-progress': '正式交付进行中',
  'ci-failed': 'CI失败，正式交付未完成',
  'pr-verified-awaiting-main': 'PR验证通过，主线交付未完成',
  'main-verified-awaiting-handoff': 'main验证通过，运行交接未完成',
  'handoff-verified-awaiting-settlement': '运行交接通过，保全清理与关闭未完成',
  delivered: '已正式交付',
};
function read(file) {
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe status source');
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function deliveryStatus(directory, batch, registry) {
  assert.match(batch, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const file = path.join(directory, 'completion-session.json');
  if (!existsSync(file))
    return {
      version: 1,
      batch,
      phase: 'local-validation',
      label: labels['local-validation'],
      formalDeliveryComplete: false,
      localReady: Boolean(registry?.modules?.length && registry.modules.every((m) => m.status === 'ready')),
    };
  const state = read(file);
  assert.equal(state.batch, batch);
  const phase = completionPhase(state),
    summary = completionSummary(state);
  const common = path.dirname(path.dirname(directory));
  const batchTiming = readTimingSummary(common, batch) ?? { status: 'legacy-unavailable', wallMs: null };
  const result = {
    version: 1,
    batch,
    phase,
    label: labels[phase],
    formalDeliveryComplete: false,
    summary,
    timingScope: 'formal-delivery-only',
    batchTiming,
    timingComplete: batchTiming.status === 'completed',
  };
  if (phase !== 'delivered') return result;
  assert.ok(registry?.closedAt, 'Closure registry missing; retain pending state');
  assert.equal(registry.id, batch);
  const receiptFile = path.join(directory, 'completion-receipt.json');
  if (!existsSync(receiptFile))
    return { ...result, phase: 'handoff-verified-awaiting-settlement', label: '阶段完成但正式回执缺失，待恢复回执' };
  const receipt = read(receiptFile),
    main = registry.main?.local;
  assert.match(main ?? '', /^[a-f0-9]{40}$/);
  assert.equal(registry.main.remote, main);
  assert.equal(receipt.results?.close?.result?.batch, batch);
  assert.equal(receipt.results.close.result.main.local, main);
  const ci = [...state.events]
    .reverse()
    .find(
      (e) => e.name === 'ci' && e.status === 'success' && e.result?.headSha === main && e.result?.branch === 'main',
    );
  assert.ok(ci, 'Final main CI evidence missing');
  assertCompletionQuality(ci.result, main, String(ci.result.runId));
  const key = main + ':' + ci.result.runId;
  for (const name of ['evidence', 'handoff', 'preserve', 'cleanup', 'close'])
    assert.ok(
      state.events.some((e) => e.name === name && e.key === key && e.status === 'success'),
      'Missing final stage ' + name,
    );
  if (receipt.remoteSnapshot) assert.equal(receipt.remoteSnapshot.main, main);
  let humanPauseObservation = null;
  const observationFile = path.join(directory, 'delivery-observations.json');
  if (existsSync(observationFile)) {
    const observations = read(observationFile);
    if (
      observations.batch === batch &&
      observations.main === main &&
      observations.humanPause?.requestedByUser &&
      state.events.some(
        (e) => e.id === observations.humanPause.interruptedEvent && e.failure?.category === 'interrupted',
      )
    )
      humanPauseObservation = { known: true, exactDurationMs: null, source: 'retained-human-pause-observation' };
  }
  return {
    ...result,
    formalDeliveryComplete: true,
    historical: true,
    main,
    closedAt: registry.closedAt,
    verifiedAt: receipt.remoteSnapshot?.checkedAt ?? registry.closedAt,
    sourceReceipt: 'completion-receipt.json',
    sourceReceiptDigest: hash(readFileSync(receiptFile)),
    humanPauseObservation,
    originalReceiptTiming: { repairMs: receipt.summary?.repairMs, timingVersion: receipt.summary?.timingVersion ?? 1 },
    meaning: 'Historical completed delivery from retained proof; not a new live remote or runtime check.',
  };
}
export function backfillDeliveryStatus(directory, batch, registry, { receiptRestored = false } = {}) {
  assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), 'Unsafe status directory');
  assert.equal(lstatSync(directory).mode & 0o077, 0, 'Status directory must be owner-only');
  const status = deliveryStatus(directory, batch, registry);
  assert.equal(status.formalDeliveryComplete, true, 'Only proven closed delivery can be backfilled');
  const file = path.join(directory, 'completion-status.json');
  if (existsSync(file)) {
    const prior = read(file);
    assert.equal(prior.batch, batch);
    assert.match(prior.sourceReceiptDigest, /^[a-f0-9]{64}$/, 'Unknown prior status proof');
    if (prior.sourceReceiptDigest !== status.sourceReceiptDigest) {
      assert.ok(receiptRestored, 'Original receipt changed; preserve prior index');
      const receipt = read(path.join(directory, 'completion-receipt.json'));
      assert.equal(receipt.historical, true, 'Receipt was not reconstructed');
      const retained = path.join(
        directory,
        'completion-status-before-restoration-' + prior.sourceReceiptDigest + '.json',
      );
      const bytes = readFileSync(file);
      if (existsSync(retained)) assert.equal(readFileSync(retained, 'utf8'), bytes.toString('utf8'));
      else writeFileSync(retained, bytes, { flag: 'wx', mode: 0o600 });
      status.previousReceiptDigest = prior.sourceReceiptDigest;
      status.receiptReconstructed = true;
    }
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(status, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
  return status;
}
