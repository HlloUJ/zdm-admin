import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performanceSummary, savePerformanceSummary, phaseEvidence } from './verification-performance.mjs';
test('parallel work is not counted twice and failed phases remain failed', () => {
  const summary = performanceSummary({
    candidate: { head: 'one' },
    elapsedMs: 110,
    exitCode: 1,
    phases: [
      { name: 'a', startMs: 0, elapsedMs: 100, exitCode: 0 },
      { name: 'b', startMs: 0, elapsedMs: 110, exitCode: 1 },
    ],
  });
  assert.equal(summary.elapsedMs, 110);
  assert.equal(summary.longestPhase, 'b');
  assert.equal(summary.exitCode, 1);
  assert.equal(summary.phases[1].exitCode, 1);
});
test('performance summaries retain candidate and reuse status, never read outside verification evidence', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-performance-'));
  t.after(() => rmSync(root, { recursive: true }));
  const value = performanceSummary({
    candidate: { head: 'sha' },
    elapsedMs: 1,
    exitCode: 0,
    phases: [{ name: 'api', reused: true, elapsedMs: 1, originalElapsedMs: 500000 }],
  });
  assert.deepEqual(JSON.parse(readFileSync(savePerformanceSummary(root, 'run', value))), value);
  assert.deepEqual(phaseEvidence(root, { evidence: '/etc/passwd' }), {});
});
