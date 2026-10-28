import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Observability only: never authorizes reuse, changes selection, or converts a failed check to success.
export function performanceSummary({ candidate, elapsedMs, exitCode, phases }) {
  return {
    version: 1,
    candidate,
    elapsedMs: Math.round(elapsedMs),
    exitCode,
    phases: phases.map((phase) => ({ ...phase, elapsedMs: Math.round(phase.elapsedMs) })),
    // Work can overlap; retain offsets instead of adding phase durations to task wall time.
    longestPhase: [...phases].sort((a, b) => b.elapsedMs - a.elapsedMs)[0]?.name ?? null,
  };
}
export function savePerformanceSummary(root, runId, summary) {
  const directory = path.join(root, '.task-verification/runs', runId);
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'performance.json');
  writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
  return file;
}
export function phaseEvidence(root, result) {
  if (!result?.evidence) return {};
  const file = path.resolve(result.evidence);
  if (!file.startsWith(path.resolve(root, '.task-verification') + path.sep)) return {};
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    return {
      commandMs: result.reused ? 0 : record.commandMs,
      probeMs: result.reused ? undefined : record.probeMs,
      cacheMissReason: result.reused ? undefined : record.cacheMissReason,
      evidence: path.relative(root, file),
      originalElapsedMs: result.reused ? record.elapsedMs : undefined,
    };
  } catch {
    return {};
  }
}
