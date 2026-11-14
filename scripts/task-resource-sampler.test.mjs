import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMacMemory,
  parseCpu,
  parseSwap,
  parseDockerMemory,
  parsePressure,
  collectResourceTelemetry,
} from './task-resource-sampler.mjs';
test('Mac and Docker telemetry have separate memory budgets', () => {
  assert.equal(parseMacMemory('System-wide memory free percentage: 70%', 24 * 1024 ** 3).freePercent, 70);
  assert.equal(parseDockerMemory('MemTotal: 8000 kB\nMemAvailable: 5000 kB').availableBytes, 5120000);
});
test('CPU swap and PSI parsing', () => {
  assert.equal(parseCpu('CPU usage: 8.1% user, 1.9% sys, 90.0% idle'), 10);
  assert.equal(parseSwap('total = 1024.00M used = 12.00M free = 1012.00M'), 12 * 1024 ** 2);
  assert.equal(parsePressure('some avg10=0.12 avg60=0.03'), 0.12);
});
test('unknown output fails closed, no fabricated zero', () => {
  assert.throws(() => parseCpu('denied'));
  assert.throws(() => parseMacMemory('denied', 1));
  assert.throws(() => parseDockerMemory('denied'));
  assert.throws(() => parsePressure('unsupported'));
});
test('failed sensors explicit; no container is created or persistent process started', () => {
  const calls = [];
  const s = collectResourceTelemetry({
    containerId: 'a'.repeat(64),
    diskPath: '/workspace',
    run: (c, a) => {
      calls.push([c, a]);
      throw Error('unavailable');
    },
  });
  assert.equal(s.errors.length, 7);
  assert.ok(calls.every(([c, a]) => c !== 'docker' || a[0] === 'exec'));
  assert.equal(s.cpuBusyPercent, undefined);
});
test('reject command-like container IDs', () => {
  assert.throws(() => collectResourceTelemetry({ containerId: '--privileged', diskPath: '/' }));
});
