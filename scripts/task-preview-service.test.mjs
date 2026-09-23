import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import {
  dockerDesktopLaunchCommand,
  INTEGRATION_PREVIEW_URL,
  launchAgentPlist,
  main,
  MANAGED_TASK_PREVIEW_PORT,
  normalizedPath,
  parseServiceArgs,
  PreviewGateway,
  PreviewSupervisor,
  previewCommand,
  readServiceStatus,
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
    json: false,
    taskArgs: [],
  });
  assert.deepEqual(parseServiceArgs(['install', '--worktree', '/tmp/task', '--mode', 'full']), {
    command: 'install',
    worktree: '/tmp/task',
    lines: 120,
    json: false,
    taskArgs: ['--mode', 'full'],
  });
  assert.deepEqual(parseServiceArgs(['logs', '--lines', '25']), {
    command: 'logs',
    worktree: null,
    lines: 25,
    json: false,
    taskArgs: [],
  });
  assert.equal(parseServiceArgs(['status', '--json']).json, true);
  assert.equal(parseServiceArgs(['--help']).command, 'help');
  assert.throws(() => parseServiceArgs(['logs', '--lines', '0']), /1 至 1000/);
  assert.throws(() => parseServiceArgs(['switch', '--json']), /只能用于 status/);
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
      args: [
        '/repo/scripts/dev-task.mjs',
        '--worktree',
        '/repo task',
        '--port',
        String(MANAGED_TASK_PREVIEW_PORT),
        '--mode',
        'frontend',
      ],
    },
  );
});

function listen(server) {
  server.listen(0, '127.0.0.1');
  return once(server, 'listening');
}

function serverUrl(server) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}/`;
}

function requestText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function requestUpgrade(url) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(target.port), target.hostname);
    socket.once('connect', () => {
      socket.write(
        `GET /hmr HTTP/1.1\r\nHost: ${target.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGVzdC1nYXRld2F5\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.once('data', (chunk) => {
      socket.destroy();
      resolve(chunk.toString('utf8').split('\r\n', 1)[0]);
    });
    socket.once('error', reject);
  });
}

test('keeps one gateway online while switching between integration and task upstreams', async (context) => {
  const integration = http.createServer((request, response) => response.end(`integration:${request.url}`));
  const task = http.createServer((request, response) => response.end(`task:${request.url}`));
  task.on('upgrade', (request, socket) => {
    socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  await Promise.all([listen(integration), listen(task)]);
  const taskAddress = task.address();
  assert.ok(taskAddress && typeof taskAddress === 'object');

  const gateway = new PreviewGateway({ port: 0, integrationUrl: serverUrl(integration) });
  await gateway.start();
  context.after(async () => {
    await gateway.stop();
    await Promise.all([closeServer(integration), closeServer(task)]);
  });

  assert.equal(gateway.status().mode, 'integration-fallback');
  assert.deepEqual(await requestText(new URL('/category', serverUrl(gateway.server))), {
    status: 200,
    body: 'integration:/category',
  });

  gateway.useTask(taskAddress.port);
  assert.equal(gateway.status().mode, 'task');
  assert.deepEqual(await requestText(new URL('/category', serverUrl(gateway.server))), {
    status: 200,
    body: 'task:/category',
  });
  assert.equal(await requestUpgrade(serverUrl(gateway.server)), 'HTTP/1.1 101 Switching Protocols');

  gateway.useIntegration();
  assert.equal(gateway.status().mode, 'integration-fallback');
  assert.deepEqual(await requestText(new URL('/again', serverUrl(gateway.server))), {
    status: 200,
    body: 'integration:/again',
  });
});

test('keeps the gateway reachable when the integration upstream is unavailable', async (context) => {
  const unavailable = http.createServer();
  await listen(unavailable);
  const unavailableUrl = serverUrl(unavailable);
  await closeServer(unavailable);

  const gateway = new PreviewGateway({ port: 0, integrationUrl: unavailableUrl });
  await gateway.start();
  context.after(() => gateway.stop());

  const response = await requestText(new URL('/', serverUrl(gateway.server)), {
    headers: { accept: 'text/html' },
  });
  assert.equal(response.status, 503);
  assert.match(response.body, /5175 入口运行正常/);
});

test('uses stable public and internal preview endpoints', () => {
  assert.equal(INTEGRATION_PREVIEW_URL, 'http://127.0.0.1:5173/');
  assert.equal(MANAGED_TASK_PREVIEW_PORT, 5176);
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

function supervisorFixture({ unhealthy = false, blocked = false } = {}) {
  const events = [];
  const root = '/repo/task';
  const gateway = {
    mode: 'task',
    status() {
      return { mode: this.mode, upstream: 'http://127.0.0.1:5176', listening: true };
    },
    useIntegration() {
      this.mode = 'integration-fallback';
    },
    useTask() {
      this.mode = 'task';
    },
  };
  const config = {
    selectedWorktree: root,
    taskArgs: ['--mode', 'full'],
    nodePath: process.execPath,
    launcherPath: '/repo/scripts/dev-task.mjs',
  };
  const supervisor = new PreviewSupervisor({ logFile: '/tmp/preview.log' }, config, gateway, {
    resolveTaskWorktree: (worktree) => ({ root: worktree, branch: 'codex/task' }),
    writeConfig: () => events.push('save'),
    checkSelectedPreview: async () => {
      events.push('check');
      if (unhealthy) throw new Error('API health unavailable');
    },
    ensureDockerReady: async () => events.push('docker-ready'),
    stopChild: async (child) => {
      events.push('stop');
      child.exitCode = 0;
    },
    spawn: (command, args) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [config.launcherPath, '--worktree', root, '--port', '5176', '--mode', 'full']);
      events.push('launch-protected-task');
      return Object.assign(new EventEmitter(), { pid: 123, exitCode: null });
    },
    waitForPreview: async () => {
      events.push('ready');
      if (blocked) throw new Error('共享数据库正由另一任务执行结构任务');
      return { branch: 'codex/task' };
    },
  });
  supervisor.child = Object.assign(new EventEmitter(), { pid: 122, exitCode: null });
  supervisor.currentWorktree = root;
  supervisor.currentTaskArgs = [...config.taskArgs];
  supervisor.phase = 'running';
  return { supervisor, root, config, events, gateway };
}

test('same-worktree healthy switch validates the actual preview without restarting', async () => {
  const f = supervisorFixture();
  const child = f.supervisor.child;
  const result = await f.supervisor.switch(f.root, f.config.taskArgs);
  assert.equal(result.phase, 'running');
  assert.equal(f.supervisor.child, child);
  assert.deepEqual(f.events, ['save', 'check']);
});

test('same-worktree failed preview check reaches protected recovery instead of the running fast path', async () => {
  const f = supervisorFixture({ unhealthy: true });
  const result = await f.supervisor.switch(f.root, f.config.taskArgs);
  assert.equal(result.phase, 'running');
  assert.deepEqual(f.events, ['save', 'check', 'docker-ready', 'stop', 'launch-protected-task', 'ready', 'ready']);
});

test('a child that exits during the asynchronous check is recovered instead of reporting stale reuse', async () => {
  const f = supervisorFixture();
  f.supervisor.dependencies.checkSelectedPreview = async () => {
    f.events.push('check');
    f.supervisor.child = null;
    f.supervisor.phase = 'error';
    f.gateway.useIntegration();
  };
  const result = await f.supervisor.switch(f.root, f.config.taskArgs);
  assert.equal(result.phase, 'running');
  assert.ok(f.events.includes('launch-protected-task'));
});

test('recovery propagates launcher protection failure and preserves the selected task', async () => {
  const f = supervisorFixture({ unhealthy: true, blocked: true });
  try {
    await assert.rejects(f.supervisor.switch(f.root, f.config.taskArgs), /共享数据库/);
    assert.equal(f.supervisor.config.selectedWorktree, f.root);
    assert.equal(f.supervisor.child, null);
    assert.equal(f.gateway.mode, 'integration-fallback');
    assert.equal(f.events.filter((event) => event === 'launch-protected-task').length, 1);
  } finally {
    f.supervisor.clearRestart();
  }
});

test('switch refuses another selected task before saving or stopping resources', async () => {
  const f = supervisorFixture();
  await assert.rejects(f.supervisor.switch('/repo/other', []), /请先交接/);
  assert.deepEqual(f.events, []);
  assert.equal(f.supervisor.config.selectedWorktree, f.root);
});

test('a live child with inconsistent selection is not reassigned before ownership is resolved', async () => {
  const f = supervisorFixture();
  f.supervisor.config.selectedWorktree = null;
  await assert.rejects(f.supervisor.switch('/repo/other', []), /进程归属/);
  assert.deepEqual(f.events, []);
  assert.equal(f.supervisor.config.selectedWorktree, null);
});

function offlineStatusDependencies(config) {
  return {
    request: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    read: () => config,
    exists: () => true,
  };
}

test('CLI status returns offline ownership without ensuring or starting a service', async () => {
  const paths = servicePaths('/tmp/status-fixture');
  const output = [];
  await main(['status', '--json'], {
    servicePaths: () => paths,
    readServiceStatus: (target) =>
      readServiceStatus(
        target,
        offlineStatusDependencies({
          launcherPath: '/repo/scripts/dev-task.mjs',
          nodePath: process.execPath,
          selectedWorktree: '/repo/task',
        }),
      ),
    ensureService: () => assert.fail('status must not kickstart launchd'),
    requestJson: () => assert.fail('status must not mutate service state'),
    log: (value) => output.push(JSON.parse(value)),
  });
  assert.equal(output[0].phase, 'offline');
  assert.equal(output[0].selectionKnown, true);
  assert.equal(output[0].worktree, '/repo/task');
  assert.equal(output[0].servicePid, null);
  assert.equal(output[0].url, null);
});

test('offline status with corrupt ownership remains unknown rather than claiming an empty task', async () => {
  const status = await readServiceStatus(servicePaths('/tmp/status-fixture'), {
    ...offlineStatusDependencies(null),
    read: () => {
      throw new Error('corrupt config');
    },
  });
  assert.equal(status.phase, 'offline');
  assert.equal(status.selectionKnown, false);
});

test('explicit same-task switch can restore offline service and rechecks ownership before switching', async () => {
  for (const restoredWorktree of ['/repo/task', '/repo/other']) {
    const actions = [];
    const promise = main(['switch', '--worktree', '/repo/task'], {
      resolveTaskWorktree: (root) => ({ root }),
      readServiceStatus: async () => ({ phase: 'offline', selectionKnown: true, worktree: '/repo/task' }),
      ensureService: async () => {
        actions.push('ensure');
        return { phase: 'running', worktree: restoredWorktree };
      },
      requestJson: async (request) => {
        assert.equal(request.requestPath, '/switch');
        actions.push('switch');
        return { phase: 'running' };
      },
      printStatus: () => {},
    });
    if (restoredWorktree === '/repo/task') {
      await promise;
      assert.deepEqual(actions, ['ensure', 'switch']);
    } else {
      await assert.rejects(promise, /请先交接/);
      assert.deepEqual(actions, ['ensure']);
    }
  }
});

test('offline stop and unknown-owner switch do not kickstart or mutate service state', async () => {
  const dependencies = {
    resolveTaskWorktree: (root) => ({ root }),
    readServiceStatus: async () => ({ phase: 'offline', selectionKnown: false, worktree: null }),
    ensureService: () => assert.fail('must not start a service'),
    requestJson: () => assert.fail('must not mutate service state'),
  };
  await assert.rejects(main(['stop'], dependencies), /服务离线/);
  await assert.rejects(main(['switch', '--worktree', '/repo/task'], dependencies), /任务归属未知/);
});
