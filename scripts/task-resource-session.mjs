import assert from 'node:assert/strict';
import { exportSchedulerNotices } from './task-resource-event-link.mjs';
import { runSchedulerLoop } from './task-resource-service.mjs';
// Explicit, in-process composition only. No service installation, task adoption, OS settings or
// external dashboard. All callers must supply an abort signal and already-owned stores/broker.
export async function runSchedulerSession({
  broker,
  outbox,
  resolveTask,
  sample,
  signal,
  intervalMs = 5000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onNotificationHealth = () => {},
}) {
  assert.ok(signal && typeof signal.aborted === 'boolean');
  assert.ok(intervalMs >= 1000);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const health = (value) => {
    try {
      onNotificationHealth(value);
    } catch {
      /* advisory only */
    }
  };
  const notify = async () => {
    while (!controller.signal.aborted) {
      try {
        exportSchedulerNotices({ broker, outbox, resolveTask });
        await outbox.pump();
        health({ status: 'processed' });
      } catch (error) {
        health({ status: 'pending-error', error: error.message });
      }
      if (!controller.signal.aborted) await sleep(intervalMs);
    }
  };
  try {
    await Promise.all([
      runSchedulerLoop({ broker, sample, signal: controller.signal, intervalMs, sleep }).finally(abort),
      notify(),
    ]);
  } finally {
    abort();
    signal.removeEventListener('abort', abort);
  }
}
