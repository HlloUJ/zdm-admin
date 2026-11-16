import { AsyncLocalStorage } from 'node:async_hooks';
import { createProgressOutbox, flushProgress } from './task-progress-outbox.mjs';

const context = new AsyncLocalStorage();
// In-process injection only. No timers, service, credentials, task reexecution or platform API emulation.
export function createProgressHost(adapter, { onError = console.error } = {}) {
  const pending = new Set();
  let protectedTurns = 0;
  let scheduled = false;
  let flushing = null;
  let generation = 0;
  const guardedAdapter = Object.fromEntries(
    ['read', 'apply'].map((name) => [
      name,
      (...args) => {
        if (protectedTurns) throw new Error('progress-transport-deferred');
        return adapter[name](...args);
      },
    ]),
  );
  function kick() {
    if (scheduled || flushing || protectedTurns || !pending.size) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (protectedTurns || flushing) return;
      const launchedGeneration = generation;
      const directories = [...pending];
      pending.clear();
      flushing = (async () => {
        for (const directory of directories) {
          if (protectedTurns) {
            pending.add(directory);
            continue;
          }
          try {
            const box = createProgressOutbox(directory);
            await flushProgress(box, guardedAdapter);
            if (box.read().pending.length) pending.add(directory);
          } catch (error) {
            pending.add(directory);
            onError(error.message);
          }
        }
      })().finally(() => {
        flushing = null;
        if (generation !== launchedGeneration) kick();
      });
      // No self retry: a new authoritative receipt or existing host transport-ready event is required.
    });
  }
  const runner = {
    run: (work) => context.run(runner, work),
    notify(directory) {
      pending.add(directory);
      generation++;
      kick();
    },
    transportReady: kick,
    hold() {
      protectedTurns++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          protectedTurns--;
          kick();
        }
      };
    },
    async settled() {
      await new Promise((resolve) => setImmediate(resolve));
      await flushing;
    },
  };
  return runner;
}
export function notifyProgressHost(directory) {
  context.getStore()?.notify(directory);
}
export function holdProgressTransport() {
  return context.getStore()?.hold() ?? (() => {});
}
