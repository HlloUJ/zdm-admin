import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'vite';
import config from '../vite.config.js';

test(
  'Vite observes real source changes but does not watch verification or backend report artifacts',
  { timeout: 15000 },
  async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-vite-watch-'));
    for (const folder of ['src', 'backend/target/site', '.task-verification/logs', '.task-runtime/cache'])
      mkdirSync(path.join(root, folder), { recursive: true });
    const source = path.join(root, 'src/probe.js');
    for (const folder of ['backend/target/site', '.task-verification/logs', '.task-runtime/cache'])
      writeFileSync(path.join(root, folder, 'artifact.html'), 'report');
    const watch = config({ mode: 'test' }).server.watch;
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, watch: { ...watch, ignoreInitial: false } },
    });
    t.after(async () => {
      await server.close();
      rmSync(root, { recursive: true });
    });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Source watcher failed to become ready')), 5000);
      server.watcher.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await server.listen();
    await ready;

    function sourceEvent(event, message) {
      return new Promise((resolve, reject) => {
        const onEvent = (file) => {
          if (file !== source) return;
          clearTimeout(timer);
          server.watcher.off(event, onEvent);
          resolve();
        };
        const timer = setTimeout(() => {
          server.watcher.off(event, onEvent);
          reject(new Error(message));
        }, 5000);
        server.watcher.on(event, onEvent);
      });
    }

    // Wait for a filesystem event from the new file before testing its next write.
    const added = sourceEvent('add', 'Source watcher missed a new file');
    writeFileSync(source, 'export const x=1;', { flag: 'wx' });
    await added;
    assert.ok(server.watcher.getWatched()[path.dirname(source)]?.includes(path.basename(source)));
    const watched = Object.keys(server.watcher.getWatched());
    for (const folder of ['backend/target', '.task-verification', '.task-runtime'])
      assert.ok(!watched.some((directory) => directory.startsWith(path.join(root, folder))), folder);
    const changed = sourceEvent('change', 'Source HMR stopped working');
    writeFileSync(source, 'export const x=2;');
    await changed;
  },
);
