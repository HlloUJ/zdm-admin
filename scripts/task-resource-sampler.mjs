import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(execFile);
const runAsync = async (command, args) =>
  (await execAsync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
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

// Async passive sampling keeps system commands off the scheduler's JS event loop.
// The same already-existing container restriction applies; never starts Docker or a container.
export async function collectResourceTelemetryAsync({ containerId, diskPath, run = runAsync, now = Date.now }) {
  assert.match(containerId, /^[a-f0-9]{12,64}$/);
  assert.ok(diskPath.startsWith('/'));
  const result = { at: now(), errors: [] };
  const read = async (name, fn) => {
    try {
      result[name] = await fn();
    } catch (error) {
      result.errors.push({ metric: name, error: error.code ?? error.message });
    }
  };
  // Bounded serial commands: no sampling bursts while other deliveries run.
  await read('macMemory', async () =>
    parseMacMemory(
      await run('/usr/bin/memory_pressure', []),
      Number((await run('/usr/sbin/sysctl', ['-n', 'hw.memsize'])).trim()),
    ),
  );
  await read('cpuBusyPercent', async () => parseCpu(await run('/usr/bin/top', ['-l', '1', '-n', '0'])));
  await read('swapUsedBytes', async () => parseSwap(await run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'])));
  await read('diskAvailableBytes', async () => {
    const rows = (await run('/bin/df', ['-k', diskPath])).trim().split('\n');
    const value = Number(rows.at(-1).trim().split(/\s+/)[3]) * 1024;
    assert.ok(Number.isFinite(value) && value >= 0);
    return value;
  });
  await read('dockerMemory', async () =>
    parseDockerMemory(await run('docker', ['exec', containerId, 'cat', '/proc/meminfo'])),
  );
  await read('dockerMemoryPressure10', async () =>
    parsePressure(await run('docker', ['exec', containerId, 'cat', '/proc/pressure/memory'])),
  );
  await read('dockerIoPressure10', async () =>
    parsePressure(await run('docker', ['exec', containerId, 'cat', '/proc/pressure/io'])),
  );
  result.completedAt = now();
  return result;
}
