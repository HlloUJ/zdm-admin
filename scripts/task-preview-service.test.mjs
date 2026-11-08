import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';

import {
  RETAINED_HANDOFF_PROTOCOL,
  resolveRetainedPreview,
  assertBatchStopAllowed,
  retainedPublishedPreview,
  retainedHandoffProof,
  statusForProtocol,
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

test('keeps the gateway online and never falls back to integration while preview is unavailable', async (context) => {
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

  assert.equal(gateway.status().mode, 'preview-unavailable');
  assert.equal(gateway.status().upstream, null);
  assert.equal((await requestText(new URL('/category', serverUrl(gateway.server)))).status, 503);

  gateway.useTask(taskAddress.port);
  assert.equal(gateway.status().mode, 'task');
  assert.deepEqual(await requestText(new URL('/category', serverUrl(gateway.server))), {
    status: 200,
    body: 'task:/category',
  });
  assert.equal(await requestUpgrade(serverUrl(gateway.server)), 'HTTP/1.1 101 Switching Protocols');

  gateway.useIntegration();
  assert.equal(gateway.status().mode, 'preview-unavailable');
  assert.equal(gateway.status().upstream, null);
  assert.equal((await requestText(new URL('/again', serverUrl(gateway.server)))).status, 503);
  assert.equal(await requestUpgrade(serverUrl(gateway.server)), 'HTTP/1.1 503 Service Unavailable');
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
  let healthChecks = 0;
  const root = '/repo/task';
  const gateway = {
    mode: 'task',
    status() {
      return { mode: this.mode, upstream: 'http://127.0.0.1:5176', listening: true };
    },
    useIntegration() {
      this.mode = 'preview-unavailable';
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
    assertStopAllowed: () => {},
    writeConfig: () => events.push('save'),
    checkSelectedPreview: async () => {
      events.push('check');
      if (unhealthy && ++healthChecks === 1) throw new Error('API health unavailable');
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
    log: () => {},
    error: () => {},
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
  assert.deepEqual(f.events, [
    'save',
    'check',
    'docker-ready',
    'stop',
    'launch-protected-task',
    'ready',
    'ready',
    'check',
  ]);
});

test('a child that exits during the asynchronous check is recovered instead of reporting stale reuse', async () => {
  const f = supervisorFixture();
  let checks = 0;
  f.supervisor.dependencies.checkSelectedPreview = async () => {
    f.events.push('check');
    if (++checks === 1) {
      f.supervisor.child = null;
      f.supervisor.phase = 'error';
      f.gateway.useIntegration();
    }
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
    assert.equal(f.gateway.mode, 'preview-unavailable');
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

test('status stays healthy after an idle control socket expires during synchronous work', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'zdm-ctrl-'));
  const socketFile = path.join(directory, 's.sock');
  const closed = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const http = require('node:http');
     const closed = new Int32Array(workerData.closed);
     let idleSocket;
     const server = http.createServer((request, response) => {
       idleSocket = request.socket;
       response.setHeader('content-type', 'application/json');
       response.setHeader('keep-alive', 'timeout=5');
       response.end(JSON.stringify({
         type: 'zdm-task-preview-service', phase: 'running', worktree: '/tmp/retained-preview'
       }));
     });
     server.keepAliveTimeout = 0;
     parentPort.on('message', () => {
       const notify = () => { Atomics.store(closed, 0, 1); Atomics.notify(closed, 0); };
       if (idleSocket.destroyed) notify();
       else { idleSocket.once('close', notify); idleSocket.destroy(); }
     });
     server.listen(workerData.socketFile, () => parentPort.postMessage('ready'));`,
    { eval: true, workerData: { socketFile, closed: closed.buffer } },
  );
  t.after(async () => {
    await worker.terminate();
    rmSync(directory, { recursive: true, force: true });
  });
  await once(worker, 'message');
  const paths = {
    socketFile,
    configFile: path.join(directory, 'absent-config.json'),
    launchAgentFile: path.join(directory, 'absent-agent.plist'),
  };
  assert.equal((await readServiceStatus(paths)).phase, 'running');
  // Let Node return the first socket to its pool before blocking this client only.
  await new Promise((resolve) => setImmediate(resolve));
  // Wait for actual server close while the client cannot process it.
  worker.postMessage('expire');
  assert.notEqual(Atomics.wait(closed, 0, 0, 5000), 'timed-out');
  const status = await readServiceStatus(paths);
  assert.equal(status.phase, 'running', status.lastError);
  assert.equal(status.worktree, '/tmp/retained-preview');
});

function retainedSupervisorFixture() {
  const f = supervisorFixture();
  const source = '/repo/preview-current';
  f.supervisor.config.selectedWorktree = source;
  f.supervisor.currentWorktree = source;
  const proof = { source, target: f.root, main: 'a'.repeat(40), profileFingerprint: 'profile-v1', batchId: 'next' };
  f.supervisor.dependencies.retainedHandoffProof = (target, previous, options) => {
    assert.equal(target, f.root);
    assert.equal(previous, source);
    assert.equal(options.freshRemote, true);
    f.events.push('verify');
    return { ...proof };
  };
  f.supervisor.dependencies.stopRetainedBackend = async (_config, previous) => {
    assert.equal(previous, source);
    f.events.push('stop-backend');
  };
  const expected = { ...proof, servicePid: process.pid, childPid: f.supervisor.child.pid };
  return { ...f, source, proof, expected };
}

test('safe retained handoff verifies the live source and proof before stopping, then preserves data proof', async () => {
  const f = retainedSupervisorFixture();
  const result = await f.supervisor.switch(f.root, ['--mode', 'full'], f.expected);
  assert.equal(result.phase, 'running');
  assert.equal(result.worktree, f.root);
  assert.equal(result.retainedHandoffProtocol, RETAINED_HANDOFF_PROTOCOL);
  assert.deepEqual(f.events, [
    'check',
    'verify',
    'stop',
    'stop-backend',
    'verify',
    'save',
    'docker-ready',
    'launch-protected-task',
    'ready',
    'ready',
    'check',
  ]);
});

for (const field of ['servicePid', 'childPid', 'source', 'main', 'profileFingerprint', 'batchId']) {
  test(`retained handoff refuses a changed ${field} without stopping or changing selection`, async () => {
    const f = retainedSupervisorFixture();
    const expected = { ...f.expected, [field]: typeof f.expected[field] === 'number' ? -1 : 'different' };
    await assert.rejects(f.supervisor.switch(f.root, [], expected), /变化|归属/);
    assert.ok(!f.events.includes('stop'));
    assert.ok(!f.events.includes('save'));
    assert.equal(f.supervisor.config.selectedWorktree, f.source);
    assert.equal(f.gateway.mode, 'task');
  });
}

test('source child changed during a health check is never stopped by a stale handoff', async () => {
  const f = retainedSupervisorFixture();
  f.supervisor.dependencies.checkSelectedPreview = async () => {
    f.supervisor.child = Object.assign(new EventEmitter(), { pid: 999, exitCode: null });
  };
  await assert.rejects(f.supervisor.switch(f.root, [], f.expected), /归属已变化/);
  assert.deepEqual(f.events, []);
});

test('a failed retained health check does not stop the source', async () => {
  const f = retainedSupervisorFixture();
  f.supervisor.dependencies.checkSelectedPreview = async () => {
    throw new Error('API unavailable');
  };
  await assert.rejects(f.supervisor.switch(f.root, [], f.expected), /API unavailable/);
  assert.deepEqual(f.events, []);
});

test('retained backend stop failure keeps the original selection and a 503 gateway', async () => {
  const f = retainedSupervisorFixture();
  f.supervisor.dependencies.stopRetainedBackend = async () => {
    throw new Error('protected backend');
  };
  await assert.rejects(f.supervisor.switch(f.root, [], f.expected), /protected backend/);
  assert.equal(f.supervisor.config.selectedWorktree, f.source);
  assert.equal(f.gateway.mode, 'preview-unavailable');
  assert.ok(!f.events.includes('save'));
});

test('proof changes after stopping keep the gateway unavailable instead of starting a different data source', async () => {
  const f = retainedSupervisorFixture();
  let checks = 0;
  f.supervisor.dependencies.retainedHandoffProof = () =>
    ++checks === 1 ? f.proof : { ...f.proof, profileFingerprint: 'changed' };
  await assert.rejects(f.supervisor.switch(f.root, [], f.expected), /证明变化/);
  assert.equal(f.gateway.mode, 'preview-unavailable');
  assert.ok(!f.events.includes('save'));
  assert.ok(!f.events.includes('launch-protected-task'));
});

test('CLI sends the source identity only to a service that supports safe retained handoff', async () => {
  const f = retainedSupervisorFixture();
  const requests = [];
  const dependencies = {
    resolveTaskWorktree: (root) => ({ root }),
    readServiceStatus: async () => f.supervisor.status(),
    retainedHandoffProof: () => f.proof,
    requestJson: async (request) => {
      requests.push(request);
      return { phase: 'running' };
    },
    ensureService: () => assert.fail('must not reinstall'),
    printStatus: () => {},
  };
  await main(['switch', '--worktree', f.root], dependencies);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].payload.retainedHandoff, f.expected);
  requests.length = 0;
  await assert.rejects(
    main(['switch', '--worktree', f.root], {
      ...dependencies,
      readServiceStatus: async () => ({ ...f.supervisor.status(), retainedHandoffProtocol: undefined }),
    }),
    /一次受控升级/,
  );
  assert.equal(requests.length, 0);
});

test('legacy stop receipt remains compatible without ever selecting integration', () => {
  const status = {
    phase: 'preview-unavailable',
    mode: 'preview-unavailable',
    worktree: null,
    childPid: null,
    upstream: null,
  };
  assert.equal(statusForProtocol(status, '2'), status);
  const legacy = statusForProtocol(status);
  assert.equal(legacy.phase, 'integration-fallback');
  assert.equal(legacy.upstream, null);
  assert.equal(legacy.environment, 'preview');
  assert.equal(status.phase, 'preview-unavailable');
});

function retainedRepositoryFixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'zdm-retained-proof-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(directory, 'origin.git');
  const root = path.join(directory, 'main');
  mkdirSync(root);
  git(directory, 'init', '--bare', origin);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'fixture@example.test');
  git(root, 'config', 'user.name', 'Fixture');
  writeFileSync(path.join(root, 'marker'), 'base');
  git(root, 'add', 'marker');
  git(root, 'commit', '-m', 'base');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', 'origin', 'main');
  git(root, 'fetch', 'origin');
  const source = path.join(directory, 'preview-current');
  const target = path.join(directory, 'next-task');
  const integration = path.join(directory, 'integration');
  git(root, 'worktree', 'add', '-b', 'codex/preview-current', source, 'main');
  git(root, 'worktree', 'add', '-b', 'codex/next-task', target, 'main');
  git(root, 'worktree', 'add', '-b', 'codex/integration-current', integration, 'main');
  const common = path.join(root, '.git');
  const profileFile = path.join(common, 'preview-environment/environment.json');
  const activeFile = path.join(common, 'task-batches/active.json');
  mkdirSync(path.dirname(profileFile));
  mkdirSync(path.dirname(activeFile));
  writeFileSync(
    profileFile,
    JSON.stringify({
      version: 1,
      repository: common,
      profile: { version: 1, status: 'ready', database: 'preview_fixture', password: 'fixture-secret' },
    }),
  );
  const head = git(root, 'rev-parse', 'HEAD');
  const active = {
    version: 1,
    id: 'next-task',
    kind: 'business',
    repository: { commonDir: common, anchor: root },
    worktree: target,
    branch: 'codex/next-task',
    originMain: head,
    recordedHead: head,
  };
  writeFileSync(activeFile, JSON.stringify(active));
  return { root, source, target, integration, git, head, active, activeFile, profileFile };
}

test('real Git proof permits only a clean published carrier, active business target and retained data identity', (t) => {
  const f = retainedRepositoryFixture(t);
  assert.equal(retainedPublishedPreview(f.root, f.source), true);
  const proof = retainedHandoffProof(f.target, f.source, { freshRemote: true });
  assert.equal(proof.main, f.head);
  assert.equal(proof.batchId, 'next-task');
  assert.doesNotMatch(JSON.stringify(proof), /fixture-secret/);
  assert.match(proof.profileFingerprint, /^[a-f0-9]{64}$/);
});

for (const condition of [
  'dirty-source',
  'wrong-repository',
  'unready-profile',
  'symlink-registry',
  'database-lock',
  'infrastructure-target',
  'closed-target',
  'changed-head',
]) {
  test(`real Git proof rejects ${condition}`, (t) => {
    const f = retainedRepositoryFixture(t);
    if (condition === 'dirty-source') writeFileSync(path.join(f.source, 'unknown'), 'retain');
    if (condition === 'wrong-repository') {
      const other = retainedRepositoryFixture(t);
      assert.throws(() => retainedHandoffProof(f.target, other.source), /同一仓库/);
      return;
    }
    if (condition === 'unready-profile') {
      const record = JSON.parse(readFileSync(f.profileFile));
      record.profile.status = 'pending';
      writeFileSync(f.profileFile, JSON.stringify(record));
    }
    if (condition === 'symlink-registry') {
      const copy = f.activeFile + '.copy';
      writeFileSync(copy, readFileSync(f.activeFile));
      unlinkSync(f.activeFile);
      symlinkSync(copy, f.activeFile);
    }
    if (condition === 'database-lock') {
      const lock = path.join(f.integration, 'backups/task-preview/active-database-task.json');
      mkdirSync(path.dirname(lock), { recursive: true });
      writeFileSync(lock, '{}');
    }
    if (condition === 'infrastructure-target') {
      f.active.kind = 'infrastructure';
      writeFileSync(f.activeFile, JSON.stringify(f.active));
    }
    if (condition === 'closed-target') {
      f.active.closedAt = new Date().toISOString();
      writeFileSync(f.activeFile, JSON.stringify(f.active));
    }
    if (condition === 'changed-head') {
      f.active.recordedHead = '0'.repeat(40);
      writeFileSync(f.activeFile, JSON.stringify(f.active));
    }
    assert.throws(() => retainedHandoffProof(f.target, f.source));
  });
}

test('fresh remote check rejects a main branch that advanced beyond the local tracking ref', (t) => {
  const f = retainedRepositoryFixture(t);
  writeFileSync(path.join(f.root, 'marker'), 'new');
  f.git(f.root, 'add', 'marker');
  f.git(f.root, 'commit', '-m', 'new main');
  f.git(f.root, 'push', 'origin', 'main');
  f.git(f.root, 'update-ref', 'refs/remotes/origin/main', f.head);
  assert.equal(retainedPublishedPreview(f.root, f.source), true);
  assert.throws(() => retainedHandoffProof(f.target, f.source, { freshRemote: true }), /远端最新主线/);
});

for (const selected of ['/repo/other', null]) {
  test(`stop CLI preserves a foreign or unselected preview (${selected})`, async () => {
    await assert.rejects(
      main(['stop', '--worktree', '/repo/task'], {
        resolveTaskWorktree: (root) => ({ root }),
        readServiceStatus: async () => ({ phase: 'running', worktree: selected }),
        requestJson: () => assert.fail('must not send stop'),
      }),
      /停止目标与当前预览归属不一致/,
    );
  });
}
test('stop CLI honors the explicit owning worktree', async () => {
  let stopped = false;
  await main(['stop', '--worktree', '/repo/task'], {
    resolveTaskWorktree: (root) => ({ root }),
    readServiceStatus: async () => ({
      phase: 'running',
      worktree: '/repo/task',
      stopOwnershipProtocol: 1,
      servicePid: 1,
      childPid: 2,
      selectionRevision: 3,
    }),
    requestJson: async (request) => {
      assert.equal(request.requestPath, '/stop');
      stopped = true;
      return {};
    },
    printStatus: () => {},
  });
  assert.equal(stopped, true);
});

for (const field of ['worktree', 'childPid', 'servicePid', 'selectionRevision']) {
  test(`atomic stop rejects stale ${field} without changing gateway or child`, async () => {
    const f = supervisorFixture();
    const expected = { ...f.supervisor.status(), [field]: 'stale' };
    const child = f.supervisor.child;
    await assert.rejects(f.supervisor.stop(expected), /停止请求归属已变化或缺失/);
    assert.equal(f.supervisor.child, child);
    assert.equal(f.supervisor.status().worktree, f.root);
    assert.equal(f.gateway.mode, 'task');
    assert.deepEqual(f.events, []);
  });
}
test('atomic stop checks identity inside the serialized queue', async () => {
  const f = supervisorFixture();
  const expected = f.supervisor.status();
  const change = f.supervisor.enqueue(() => {
    f.supervisor.selectionRevision += 1;
  });
  await assert.rejects(f.supervisor.stop(expected), /停止请求归属已变化或缺失/);
  await change;
  assert.deepEqual(f.events, []);
});
test('atomic stop rejects an unscoped legacy request without stopping preview', async () => {
  const f = supervisorFixture();
  await assert.rejects(f.supervisor.stop(), /停止请求归属已变化或缺失/);
  assert.deepEqual(f.events, []);
});

test('atomic stop with matching identity stops only its selected backend', async () => {
  const f = supervisorFixture();
  const calls = [];
  f.supervisor.dependencies.run = (_node, args, options) => {
    calls.push({ args, cwd: options.cwd });
    return { status: 0 };
  };
  const result = await f.supervisor.stop(f.supervisor.status());
  assert.equal(result.worktree, null);
  assert.equal(result.childPid, null);
  assert.equal(result.mode, 'preview-unavailable');
  assert.deepEqual(calls, [{ args: [f.config.launcherPath, '--worktree', f.root, '--stop'], cwd: f.root }]);
});

test('unfinished batch stop check runs before any runtime or configuration mutation', async () => {
  const f = supervisorFixture();
  f.supervisor.dependencies.assertStopAllowed = () => {
    throw new Error('仍有未完成模块');
  };
  await assert.rejects(f.supervisor.stop(f.supervisor.status()), /仍有未完成模块/);
  assert.deepEqual(f.events, []);
  assert.equal(f.supervisor.status().worktree, f.root);
  assert.equal(f.gateway.mode, 'task');
});

test('empty selection boot restores only a proved retained carrier in full mode', async () => {
  const f = supervisorFixture();
  f.config.selectedWorktree = null;
  f.config.taskArgs = [];
  f.supervisor.child = null;
  f.supervisor.currentWorktree = null;
  f.supervisor.dependencies.resolveRetainedPreview = () => f.root;
  f.supervisor.dependencies.spawn = (_command, args) => {
    assert.deepEqual(args.slice(-2), ['--mode', 'full']);
    return Object.assign(new EventEmitter(), { pid: 456, exitCode: null });
  };
  const result = await f.supervisor.launchSelected();
  assert.equal(result.phase, 'running');
  assert.equal(result.worktree, f.root);
  assert.deepEqual(result.taskArgs, ['--mode', 'full']);
});
test('empty selection with invalid retained proof never launches or chooses integration', async () => {
  const f = supervisorFixture();
  f.config.selectedWorktree = null;
  f.supervisor.child = null;
  f.supervisor.dependencies.resolveRetainedPreview = () => {
    throw new Error('retained proof invalid');
  };
  await assert.rejects(f.supervisor.launchSelected(), /retained proof invalid/);
  assert.equal(f.config.selectedWorktree, null);
  assert.equal(f.gateway.mode, 'preview-unavailable');
  assert.deepEqual(f.events, []);
});

test('retained fallback resolves only published clean carrier with real Git and data proof', (t) => {
  const f = retainedRepositoryFixture(t);
  const config = { launcherPath: path.join(f.root, 'scripts/dev-task.mjs') };
  assert.equal(resolveRetainedPreview(config), f.source);
  writeFileSync(path.join(f.source, 'dirty'), 'keep');
  assert.throws(() => resolveRetainedPreview(config), /不干净/);
});
test('real stop policy refuses mismatched batch, unfinished modules and active workers', (t) => {
  const f = retainedRepositoryFixture(t);
  assert.throws(() => assertBatchStopAllowed(f.source), /归属不一致/);
  const active = { ...f.active, modules: [{ id: 'a', status: 'in-progress' }] };
  writeFileSync(f.activeFile, JSON.stringify(active));
  assert.throws(() => assertBatchStopAllowed(f.target), /未完成模块/);
  active.modules[0].status = 'ready';
  writeFileSync(f.activeFile, JSON.stringify(active));
  assert.doesNotThrow(() => assertBatchStopAllowed(f.target));
  const directory = path.join(path.dirname(f.activeFile), active.id + '.workers');
  mkdirSync(directory);
  writeFileSync(
    path.join(directory, 'workers.json'),
    JSON.stringify({ version: 1, workers: [{ module: 'a', resources: ['src/a.vue'] }] }),
  );
  assert.throws(() => assertBatchStopAllowed(f.target), /并行执行方/);
});

for (const failure of ['child', 'backend']) {
  test(`failed ${failure} stop preserves selected ownership and never writes an empty selection`, async () => {
    const f = supervisorFixture();
    if (failure === 'child')
      f.supervisor.dependencies.stopChild = async () => {
        throw new Error('injected stop failure');
      };
    f.supervisor.dependencies.run = () => ({ status: 1 });
    await assert.rejects(f.supervisor.stop(f.supervisor.status()));
    assert.equal(f.supervisor.status().worktree, f.root);
    assert.equal(f.supervisor.currentWorktree, f.root);
    assert.equal(f.supervisor.status().phase, 'error');
    assert.equal(f.supervisor.intentionalStop, false);
    assert.ok(!f.events.includes('save'));
    if (failure === 'child') assert.equal(f.supervisor.child.pid, 122);
  });
}
