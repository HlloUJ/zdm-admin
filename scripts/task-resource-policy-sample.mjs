import assert from 'node:assert/strict';
// Thresholds are explicit caller configuration, not claimed calibrated machine limits.
export function createPolicySampler({ collect, now = Date.now, thresholds }) {
  assert.equal(typeof collect, 'function');
  for (const key of [
    'sampleMaxAgeMs',
    'trendMaxGapMs',
    'macReserveBytes',
    'dockerMemoryPsi',
    'dockerIoPsi',
    'swapGrowthBytes',
  ])
    assert.ok(Number.isFinite(thresholds?.[key]) && thresholds[key] > 0, `Explicit positive ${key} required`);
  let previous = null,
    sampling = false;
  return async () => {
    assert.equal(sampling, false, 'Overlapping resource sample rejected');
    sampling = true;
    try {
      const raw = await collect();
      const observedAt = now();
      const values = [
        raw?.at,
        raw?.macMemory?.availableEstimateBytes,
        raw?.cpuBusyPercent,
        raw?.swapUsedBytes,
        raw?.diskAvailableBytes,
        raw?.dockerMemory?.availableBytes,
        raw?.dockerMemoryPressure10,
        raw?.dockerIoPressure10,
      ];
      const valid =
        Array.isArray(raw?.errors) &&
        raw.errors.length === 0 &&
        values.every((v) => Number.isFinite(v) && v >= 0) &&
        raw.cpuBusyPercent <= 100 &&
        raw.at <= observedAt &&
        observedAt - raw.at <= thresholds.sampleMaxAgeMs;
      if (!valid) {
        previous = null;
        return { at: observedAt, unavailable: 'Incomplete or stale Mac/Docker telemetry' };
      }
      const baseline = previous;
      previous = { at: raw.at, swap: raw.swapUsedBytes };
      if (!baseline || raw.at <= baseline.at || raw.at - baseline.at > thresholds.trendMaxGapMs)
        return { at: observedAt, unavailable: 'Fresh swap trend baseline required' };
      return {
        at: raw.at,
        macAvailableBytes: raw.macMemory.availableEstimateBytes,
        dockerAvailableBytes: raw.dockerMemory.availableBytes,
        diskAvailableBytes: raw.diskAvailableBytes,
        cpuBusyPercent: raw.cpuBusyPercent,
        memoryPressure:
          raw.macMemory.availableEstimateBytes < thresholds.macReserveBytes ||
          raw.dockerMemoryPressure10 >= thresholds.dockerMemoryPsi,
        swapGrowing: raw.swapUsedBytes - baseline.swap >= thresholds.swapGrowthBytes,
        ioCongested: raw.dockerIoPressure10 >= thresholds.dockerIoPsi,
      };
    } catch (error) {
      previous = null;
      return { at: now(), unavailable: error.message };
    } finally {
      sampling = false;
    }
  };
}
