import assert from 'node:assert/strict';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createProgressOutbox, flushProgress } from './task-progress-outbox.mjs';

const context = new AsyncLocalStorage();
// In-process injection only. No service, credentials, task reexecution or platform API emulation.
export function createProgressHost(
  adapter,
  { onError = console.error, directory = null, drainTimeoutMs = 5000, beforeStage = null } = {},
) {
  assert.ok(Number.isSafeInteger(drainTimeoutMs) && drainTimeoutMs > 0 && drainTimeoutMs <= 30000);
  const pending = new Set();
  let protectedTurns = 0,
    scheduled = null,
    flushing = null,
    generation = 0,
    preparing = 0,
    stageFailed = false;
  function start() {
    if (flushing || protectedTurns || stageFailed || !pending.size) return flushing;
    const launchedGeneration = generation,
      directories = [...pending];
    pending.clear();
    flushing = (async () => {
      for (const target of directories) {
        if (protectedTurns) {
          pending.add(target);
          continue;
        }
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), drainTimeoutMs);
        const bounded = async (name, ...args) => {
          if (protectedTurns) throw Error('progress-transport-deferred');
          controller.signal.throwIfAborted();
          let stop;
          const timeout = new Promise((_, reject) => {
            stop = () => reject(Error('progress-drain-timeout'));
            controller.signal.addEventListener('abort', stop, { once: true });
          });
          try {
            return await Promise.race([adapter[name](...args, { signal: controller.signal }), timeout]);
          } finally {
            controller.signal.removeEventListener('abort', stop);
          }
        };
        try {
          const box = createProgressOutbox(target);
          await flushProgress(box, {
            read: (...args) => bounded('read', ...args),
            apply: (...args) => bounded('apply', ...args),
            ...(adapter.readRejection ? { readRejection: (...args) => bounded('readRejection', ...args) } : {}),
            ...(adapter.history ? { history: (...args) => bounded('history', ...args) } : {}),
          });
          if (box.read().pending.length) pending.add(target);
        } catch (error) {
          pending.add(target);
          onError(error.message);
        } finally {
          clearTimeout(deadline);
        }
      }
    })().finally(() => {
      flushing = null;
      if (generation !== launchedGeneration) kick();
    });
    return flushing;
  }
  function kick() {
    if (scheduled || flushing || protectedTurns || preparing || stageFailed || !pending.size) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      start();
    });
  }
  const runner = {
    run: (work) => context.run(runner, work),
    async beforeStage(input) {
      if (!beforeStage) return;
      if (protectedTurns) throw Error('progress-transport-deferred');
      preparing++;
      if (scheduled) {
        clearImmediate(scheduled);
        scheduled = null;
      }
      try {
        await flushing;
        const transport = Object.fromEntries(
          Object.keys(adapter)
            .filter((name) => typeof adapter[name] === 'function')
            .map((name) => [
              name,
              (...args) => {
                if (protectedTurns || stageFailed) throw Error('progress-transport-deferred');
                return adapter[name](...args);
              },
            ]),
        );
        return await beforeStage({ ...input, transport });
      } catch (error) {
        stageFailed = true;
        throw error;
      } finally {
        preparing--;
        if (!stageFailed) kick();
      }
    },
    notify(target) {
      assert.ok(
        !directory || path.resolve(target) === path.resolve(directory),
        'Progress host refuses another task outbox',
      );
      pending.add(target);
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
    async drain() {
      if (protectedTurns) return { state: 'deferred-protected' };
      if (stageFailed) return { state: 'deferred-stage-failure' };
      if (scheduled) {
        clearImmediate(scheduled);
        scheduled = null;
      }
      await start();
      return { state: pending.size ? 'pending' : 'settled' };
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
// Without a real injected owner host this performs no read, network work or queue mutation.
export function drainProgressHost() {
  return context.getStore()?.drain();
}

export function prepareProgressStage(state, event) {
  return context.getStore()?.beforeStage?.({ state, event });
}
