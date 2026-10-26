import { readFileSync } from 'node:fs';
import os from 'node:os';

export function resourceObservation() {
  const optional = (file) => {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      return null;
    }
  };
  const cpu = optional('/sys/fs/cgroup/cpu.stat');
  return {
    at: Date.now(),
    loadAverage: os.loadavg(),
    runnerProcess: process.resourceUsage(),
    containerCpu: cpu
      ? Object.fromEntries(
          cpu
            .split('\n')
            .map((s) => s.split(/\s+/))
            .filter(
              ([k, v]) =>
                /^(?:usage_usec|user_usec|system_usec|nr_periods|nr_throttled|throttled_usec)$/.test(k) &&
                /^\d+$/.test(v),
            )
            .map(([k, v]) => [k, Number(v)]),
        )
      : null,
    containerMemoryBytes: Number(optional('/sys/fs/cgroup/memory.current')) || null,
  };
}
export function performanceSummary(tests, before, after) {
  return {
    schemaVersion: 1,
    tests,
    before,
    after,
    containerCpuDelta:
      before.containerCpu && after.containerCpu
        ? Object.fromEntries(
            Object.keys(before.containerCpu).map((k) => [k, after.containerCpu[k] - before.containerCpu[k]]),
          )
        : null,
    interpretation:
      'Step categories may overlap; never add them to wall duration. Runner process is not the browser or worker. Missing observations do not establish a cause.',
  };
}
