import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
export function parseMacMemory(text, totalBytes) {
  const percent = /System-wide memory free percentage:\s*(\d+)%/.exec(text);
  assert.ok(percent && Number(percent[1]) <= 100 && totalBytes > 0, 'Unrecognized Mac memory report');
  return { availableEstimateBytes: (totalBytes * Number(percent[1])) / 100, freePercent: Number(percent[1]) };
}
export function parseCpu(text) {
  const match = /CPU usage:.*?([\d.]+)% idle/.exec(text);
  assert.ok(match && Number(match[1]) <= 100, 'Unrecognized Mac CPU report');
  return 100 - Number(match[1]);
}
export function parseSwap(text) {
  const match = /used\s*=\s*([\d.]+)([KMG])/.exec(text);
  assert.ok(match, 'Unrecognized swap report');
  return Number(match[1]) * 1024 ** { K: 1, M: 2, G: 3 }[match[2]];
}
export function parseDockerMemory(text) {
  const total = /^MemTotal:\s+(\d+) kB/m.exec(text),
    available = /^MemAvailable:\s+(\d+) kB/m.exec(text);
  assert.ok(total && available && Number(available[1]) <= Number(total[1]), 'Unrecognized Docker VM memory');
  return { totalBytes: Number(total[1]) * 1024, availableBytes: Number(available[1]) * 1024 };
}
export function parsePressure(text) {
  const match = /^some avg10=([\d.]+) /m.exec(text);
  assert.ok(match, 'Pressure observation unavailable');
  return Number(match[1]);
}
// Passive diagnostic: caller supplies an already-existing container ID; never creates containers.
// A sample is not permission to run work. Missing observations are explicit, never assumed healthy.
export function collectResourceTelemetry({
  containerId,
  diskPath,
  run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 }),
}) {
  assert.match(containerId, /^[a-f0-9]{12,64}$/);
  assert.ok(diskPath.startsWith('/'));
  const result = { at: Date.now(), errors: [] };
  const read = (name, fn) => {
    try {
      result[name] = fn();
    } catch (e) {
      result.errors.push({ metric: name, error: e.code ?? e.message });
    }
  };
  read('macMemory', () =>
    parseMacMemory(run('/usr/bin/memory_pressure', []), Number(run('/usr/sbin/sysctl', ['-n', 'hw.memsize']).trim())),
  );
  read('cpuBusyPercent', () => parseCpu(run('/usr/bin/top', ['-l', '1', '-n', '0'])));
  read('swapUsedBytes', () => parseSwap(run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'])));
  read('diskAvailableBytes', () => {
    const rows = run('/bin/df', ['-k', diskPath]).trim().split('\n');
    const value = Number(rows.at(-1).trim().split(/\s+/)[3]) * 1024;
    assert.ok(Number.isFinite(value));
    return value;
  });
  read('dockerMemory', () => parseDockerMemory(run('docker', ['exec', containerId, 'cat', '/proc/meminfo'])));
  read('dockerMemoryPressure10', () =>
    parsePressure(run('docker', ['exec', containerId, 'cat', '/proc/pressure/memory'])),
  );
  read('dockerIoPressure10', () => parsePressure(run('docker', ['exec', containerId, 'cat', '/proc/pressure/io'])));
  return result;
}
