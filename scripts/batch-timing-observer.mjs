import assert from 'node:assert/strict';
import { watch, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshTimeline, readTimeline } from './batch-timing-store.mjs';

export function observeBatch(directory, token) {
  const common = path.dirname(path.dirname(directory)),
    batch = path.basename(directory),
    watches = new Map();
  let pending = null,
    closed = false;
  const stop = () => {
    closed = true;
    for (const watcher of watches.values()) watcher.close();
    if (pending) clearTimeout(pending);
  };
  const notify = () => {
    if (!pending && !closed) pending = setTimeout(update, 25);
  };
  const watchDirectory = (dir, callback) => {
    if (!watches.has(dir) && existsSync(dir))
      watches.set(
        dir,
        watch(dir, (_event, file) => callback(String(file ?? ''))),
      );
  };
  const configure = () => {
    const state = readTimeline(common, batch);
    assert.ok(state);
    for (const source of state.sources)
      watchDirectory(path.dirname(source.file), (file) => {
        if (
          readTimeline(common, batch).sources.some(
            (s) => path.dirname(s.file) === path.dirname(source.file) && path.basename(s.file) === file,
          )
        )
          notify();
      });
    const completion = path.join(common, 'task-delivery', batch);
    watchDirectory(completion, (file) => {
      if (file === 'completion-session.json') notify();
    });
    watchDirectory(path.join(common, 'task-delivery'), (file) => {
      if (file === batch) {
        configure();
        notify();
      }
    });
    watchDirectory(path.join(common, 'task-batches'), (file) => {
      if (file === 'active.json') notify();
    });
  };
  const update = () => {
    pending = null;
    if (closed) return;
    try {
      const file = path.join(directory, 'observer.json');
      if (!existsSync(file)) return;
      const owner = JSON.parse(readFileSync(file));
      assert.equal(owner.token, token, 'Observer ownership changed');
      assert.equal(owner.pid, process.pid);
      configure();
      const { summary } = refreshTimeline(common, batch);
      if (summary.status === 'completed') stop();
    } catch (error) {
      writeFileSync(
        path.join(directory, 'observer-error.json'),
        JSON.stringify({ at: Date.now(), reason: error.code ?? error.name ?? 'unknown' }) + '\n',
        { mode: 0o600 },
      );
      stop();
    }
  };
  watchDirectory(directory, (file) => {
    if (file === 'subscriptions.json') {
      configure();
      notify();
    } else if (file === 'observer.json' || file === 'observations.json') notify();
  });
  configure();
  // No self-notification from timeline/summary writes and no periodic full-history polling.
  if (existsSync(path.join(directory, 'observer.json'))) update();
  else pending = setTimeout(update, 50);
  return stop;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  observeBatch(process.argv[2], process.argv[3]);
