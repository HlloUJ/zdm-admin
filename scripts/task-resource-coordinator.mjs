import assert from 'node:assert/strict';
import { createAdmissionBroker } from './task-resource-broker.mjs';
import { createSchedulerRpc, startSchedulerSocket } from './task-resource-service.mjs';
import { createPolicySampler } from './task-resource-policy-sample.mjs';
import { collectResourceTelemetryAsync } from './task-resource-sampler.mjs';
import { createNotificationOutbox, submitMacNotification } from './task-resource-notifications.mjs';
import { createSchedulerLifecycle } from './task-resource-lifecycle.mjs';
import { runSchedulerSession } from './task-resource-session.mjs';
import { RESOURCE_POLICY } from './task-resource-scheduler.mjs';

// Explicit session composition only. Own stores and an existing local capability are supplied by
// the caller. Never installs a service, generates credentials, discovers tasks or adopts old runs.
export function createCoordinatorSession({
  store,
  journal,
  notificationStore,
  resolveBudget,
  validateEvidence,
  resolveTask,
  policy,
  thresholds,
  telemetry,
  collect = () => collectResourceTelemetryAsync(telemetry),
  mac = submitMacNotification,
  now = Date.now,
  intervalMs = 5000,
  sleep,
  closeOwnedStores,
  onNotificationHealth,
}) {
  assert.equal(new Set([store, journal, notificationStore]).size, 3, 'Independent owned stores required');
  assert.equal(typeof resolveBudget, 'function');
  assert.equal(typeof closeOwnedStores, 'function');
  // No fallback to the library's uncalibrated example numbers.
  for (const key of Object.keys(RESOURCE_POLICY))
    assert.ok(Number.isFinite(policy?.[key]) && policy[key] > 0, `Explicit policy ${key} required`);
  const policySample = createPolicySampler({ collect, thresholds, now });
  let unavailableCount = 0;
  const sample = async () => {
    const reading = await policySample();
    unavailableCount = reading.unavailable ? unavailableCount + 1 : 0;
    if (unavailableCount >= 3) throw Error(reading.unavailable);
    return reading;
  };
  const budget = (descriptor) => {
    const value = resolveBudget(descriptor);
    assert.ok(
      value?.evidence &&
        Number.isFinite(value.macPeakBytes) &&
        value.macPeakBytes >= 0 &&
        Number.isFinite(value.dockerPeakBytes) &&
        value.dockerPeakBytes >= 0,
      'Verified stage budget unavailable; no admission',
    );
    return value;
  };
  for (const job of store.read().jobs) {
    if (!['queued', 'waiting-client'].includes(job.status)) continue;
    const current = budget(job);
    assert.equal(
      current.macPeakBytes,
      job.macPeakBytes,
      'Queued stage budget changed; explicit reconciliation required',
    );
    assert.equal(
      current.dockerPeakBytes,
      job.dockerPeakBytes,
      'Queued stage budget changed; explicit reconciliation required',
    );
  }
  const broker = createAdmissionBroker({
    store,
    validateEvidence,
    now,
    policy,
    budget,
  });
  const dispatch = createSchedulerRpc({ broker, journal });
  const outbox = createNotificationOutbox({ store: notificationStore, mac, now });
  const lifecycle = createSchedulerLifecycle({ broker, closeOwnedStores });
  const abort = new AbortController();
  let started = false,
    done = null,
    endpoint = null,
    fault = null;
  return {
    dispatch,
    status() {
      return { ...lifecycle.status(), started, fault, jobs: broker.snapshot().jobs };
    },
    async start(socket) {
      assert.equal(started, false, 'Session starts once');
      assert.equal(lifecycle.status().phase, 'running');
      started = true;
      try {
        if (socket) endpoint = await startSchedulerSocket({ ...socket, dispatch });
        done = runSchedulerSession({
          broker,
          outbox,
          resolveTask,
          sample,
          signal: abort.signal,
          now,
          intervalMs,
          ...(sleep ? { sleep } : {}),
          onNotificationHealth,
        });
        // Store the failure, quiesce, and retain ownership; do not discard unknown running work.
        done = done.catch((error) => {
          fault = error.message;
          lifecycle.drain();
          abort.abort();
        });
      } catch (error) {
        fault = error.message;
        lifecycle.drain();
        throw error;
      }
      return this.status();
    },
    async stop() {
      lifecycle.drain();
      abort.abort();
      if (done) await done;
      // Keep the RPC endpoint available for original running clients to report completion.
      return this.status();
    },
    async close() {
      const state = await this.stop();
      assert.equal(state.canClose, true, 'Original active work must finish; retain coordinator ownership');
      if (endpoint) {
        await endpoint.close();
        endpoint = null;
      }
      return lifecycle.close();
    },
  };
}
