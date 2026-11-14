import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicySampler } from './task-resource-policy-sample.mjs';
import { collectResourceTelemetryAsync } from './task-resource-sampler.mjs';
const thresholds = {
  sampleMaxAgeMs: 15000,
  trendMaxGapMs: 30000,
  macReserveBytes: 100,
  dockerMemoryPsi: 5,
  dockerIoPsi: 10,
  swapGrowthBytes: 64,
};
function setup() {
  let at = 0,
    changes = {};
  const collect = async () => ({
    at,
    errors: [],
    macMemory: { availableEstimateBytes: 1000 },
    cpuBusyPercent: 10,
    swapUsedBytes: 0,
    diskAvailableBytes: 1000,
    dockerMemory: { availableBytes: 1000 },
    dockerMemoryPressure10: 0,
    dockerIoPressure10: 0,
    ...changes,
  });
  return {
    sample: createPolicySampler({ collect, now: () => at, thresholds }),
    step(v = 1000) {
      at += v;
    },
    set(v) {
      changes = v;
    },
  };
}
test('first sample fails closed; fresh trend produces complete policy reading', async () => {
  const s = setup();
  assert.match((await s.sample()).unavailable, /baseline/);
  s.step();
  assert.equal((await s.sample()).swapGrowing, false);
});
test('missing metrics reset baseline and cannot be treated healthy', async () => {
  const s = setup();
  await s.sample();
  s.step();
  s.set({ errors: [{ metric: 'docker' }] });
  assert.ok((await s.sample()).unavailable);
  s.step();
  s.set({});
  assert.match((await s.sample()).unavailable, /baseline/);
});
test('sleep gap requires a new trend before recovery window', async () => {
  const s = setup();
  await s.sample();
  s.step(40000);
  assert.ok((await s.sample()).unavailable);
  s.step();
  assert.equal((await s.sample()).ioCongested, false);
});
test('swap growth and Docker PSI independently stop fresh admission', async () => {
  const s = setup();
  await s.sample();
  s.step();
  s.set({ swapUsedBytes: 100, dockerMemoryPressure10: 6, dockerIoPressure10: 11 });
  const r = await s.sample();
  assert.equal(r.swapGrowing, true);
  assert.equal(r.memoryPressure, true);
  assert.equal(r.ioCongested, true);
});
test('unknown thresholds rejected rather than invented', () =>
  assert.throws(() => createPolicySampler({ collect() {}, thresholds: {} }), /Explicit/));
test('async telemetry invokes bounded commands serially and preserves errors', async () => {
  let active = 0,
    max = 0;
  const raw = await collectResourceTelemetryAsync({
    containerId: 'abcdef123456',
    diskPath: '/isolated',
    run: async () => {
      active++;
      max = Math.max(max, active);
      await Promise.resolve();
      active--;
      throw Error('fixture no access');
    },
  });
  assert.equal(max, 1);
  assert.equal(raw.errors.length, 7);
});
