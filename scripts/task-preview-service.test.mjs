import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  dockerDesktopLaunchCommand,
  launchAgentPlist,
  normalizedPath,
  parseServiceArgs,
  previewCommand,
  restartDelay,
  SERVICE_LABEL,
  servicePaths,
  shouldRunForeground,
  taskArgsEqual,
} from './task-preview-service.mjs';

test('parses service commands while preserving task launcher options', () => {
  assert.deepEqual(parseServiceArgs([]), {
    command: 'switch',
    worktree: null,
    lines: 120,
    taskArgs: [],
  });
  assert.deepEqual(parseServiceArgs(['install', '--worktree', '/tmp/task', '--mode', 'full']), {
    command: 'install',
    worktree: '/tmp/task',
    lines: 120,
    taskArgs: ['--mode', 'full'],
  });
  assert.deepEqual(parseServiceArgs(['logs', '--lines', '25']), {
    command: 'logs',
    worktree: null,
    lines: 25,
    taskArgs: [],
  });
  assert.equal(parseServiceArgs(['--help']).command, 'help');
  assert.throws(() => parseServiceArgs(['logs', '--lines', '0']), /1 至 1000/);
});

test('keeps temporary and explicitly ported previews in the foreground', () => {
  assert.equal(shouldRunForeground([]), false);
  assert.equal(shouldRunForeground(['--mode', 'full']), false);
  assert.equal(shouldRunForeground(['--temporary']), true);
  assert.equal(shouldRunForeground(['--port', '5180']), true);
});

test('builds the existing task launcher command without a shell', () => {
  assert.deepEqual(
    previewCommand({
      nodePath: '/opt/node',
      launcherPath: '/repo/scripts/dev-task.mjs',
      worktree: '/repo task',
      taskArgs: ['--mode', 'frontend'],
    }),
    {
      command: '/opt/node',
      args: ['/repo/scripts/dev-task.mjs', '--worktree', '/repo task', '--mode', 'frontend'],
    },
  );
});

test('restarts the same task only when its launcher options change', () => {
  assert.equal(taskArgsEqual([], []), true);
  assert.equal(taskArgsEqual(['--mode', 'full'], ['--mode', 'full']), true);
  assert.equal(taskArgsEqual(['--backend-port', '8081'], []), false);
  assert.equal(taskArgsEqual(['--mode', 'full'], ['full', '--mode']), false);
});

test('starts Docker Desktop in the background only on macOS', () => {
  assert.deepEqual(dockerDesktopLaunchCommand('darwin'), {
    command: '/usr/bin/open',
    args: ['-gj', '-a', 'Docker'],
  });
  assert.equal(dockerDesktopLaunchCommand('linux'), null);
});

test('uses capped retry backoff when dependencies are not ready', () => {
  assert.equal(restartDelay(1), 5_000);
  assert.equal(restartDelay(2), 10_000);
  assert.equal(restartDelay(10), 60_000);
});

test('creates stable per-user runtime paths', () => {
  const paths = servicePaths('/Users/test');
  assert.equal(
    paths.runtimeDirectory,
    path.join('/Users/test', 'Library', 'Application Support', 'zdm-admin', 'task-preview'),
  );
  assert.equal(paths.launchAgentFile, `/Users/test/Library/LaunchAgents/${SERVICE_LABEL}.plist`);
});

test('keeps only stable executable locations in the login service PATH', () => {
  assert.equal(
    normalizedPath('/Users/test/.local/node/bin/node'),
    [
      '/Users/test/.local/node/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ].join(path.delimiter),
  );
});

test('creates a login-persistent launchd definition with escaped paths', () => {
  const plist = launchAgentPlist({
    nodePath: '/opt/node&runtime',
    runtimeScript: '/tmp/task preview/service.mjs',
    workingDirectory: '/tmp/integration<current>',
    logFile: '/tmp/logs/task-preview.log',
    pathValue: '/opt/bin:/usr/bin',
  });
  assert.match(plist, new RegExp(`<string>${SERVICE_LABEL}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /\/opt\/node&amp;runtime/);
  assert.match(plist, /integration&lt;current&gt;/);
  assert.match(plist, /task preview\/service\.mjs/);
});
