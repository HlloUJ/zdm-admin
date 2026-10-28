import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createCompletionPreviewControl } from '../completion-preview.mjs';
import { readServiceStatus } from '../task-preview-service.mjs';
import { inspectManagedPreview } from '../dev-task.mjs';

// Real HTTP and Unix-socket probes, with only the process launch/data-binding command substituted.
export async function previewFixture(t, plan) {
  const dir = mkdtempSync('/tmp/zdm-preview-fixture-');
  const socketFile = path.join(dir, 's.sock');
  const launcherPath = path.join(dir, 'scripts/dev-task.mjs');
  mkdirSync(path.dirname(launcherPath));
  writeFileSync(launcherPath, "import { data } from './task-data-environment.mjs';");
  const state = {
    type: 'zdm-task-preview-service',
    phase: 'preview-unavailable',
    worktree: null,
    childPid: null,
    selectionKnown: true,
    installed: true,
  };
  const value = {
    state,
    starts: 0,
    bindings: 0,
    health: 200,
    failStart: false,
    failData: false,
    foreignLauncher: false,
    metadata: {
      type: 'zdm-task-preview',
      workspaceRoot: plan.preview,
      branch: 'codex/preview-current',
      mode: 'full',
      apiTarget: 'http://127.0.0.1:8081',
    },
  };
  const handler = (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/status') return response.end(JSON.stringify(state));
    if (request.url === '/__zdm_task_preview__') return response.end(JSON.stringify(value.metadata));
    response.statusCode = value.health;
    response.end(JSON.stringify({ status: value.health === 200 ? 'UP' : 'DOWN' }));
  };
  const app = http.createServer(handler),
    service = http.createServer(handler);
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => service.listen(socketFile, resolve));
  t.after(async () => {
    await Promise.all(
      [app, service].map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          }),
      ),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  value.port = app.address().port;
  value.control = createCompletionPreviewControl({
    paths: { socketFile },
    readStatus: () => readServiceStatus({ socketFile }),
    readInstalled: () => ({ nodePath: process.execPath, launcherPath }),
    inspect: (options) => inspectManagedPreview({ ...options, port: value.port }),
    execute: (root, command, args) => {
      if (command === 'git') return value.foreignLauncher ? '/foreign/.git' : plan.common;
      if (args[0]?.endsWith('task-preview-service.mjs')) {
        assert.deepEqual(args.slice(1), ['switch', '--worktree', plan.preview, '--mode', 'full']);
        value.starts++;
        if (value.failStart) throw Error('fixture startup failed');
        Object.assign(state, { phase: 'running', worktree: plan.preview, childPid: 42 });
        return '';
      }
      assert.deepEqual(args, [launcherPath, '--check', '--worktree', plan.preview]);
      value.bindings++;
      if (value.failData) throw Error('persistent data binding mismatch');
      return '';
    },
  });
  return value;
}
