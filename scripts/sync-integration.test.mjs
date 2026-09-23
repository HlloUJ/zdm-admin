import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  integrationProofMatches,
  integrationBackendIdentity,
  integrationSourceIdentity,
} from './integration-handoff-state.mjs';
import { handoffDatabaseTask, parseTaskPreviewArgs } from './dev-task.mjs';
import { runtimeDigest } from './task-runtime-state.mjs';

const script = fileURLToPath(new URL('./sync-integration.mjs', import.meta.url));
const tree = '100644 blob runtime-blob\tdocker-compose.yml';
const composeConfig = JSON.stringify({ services: { backend: { command: 'mvn spring-boot:run' } } });
function container(root, sequence = 1) {
  return {
    Id: `backend-${sequence}`,
    Image: 'maven-image',
    State: { Running: true, StartedAt: `start-${sequence}` },
    Config: { Labels: { 'com.docker.compose.service': 'backend' } },
    HostConfig: {},
    Mounts: [{ Type: 'bind', Source: root, Destination: '/workspace' }],
  };
}

// The production orchestration runs with command stand-ins and an injected handoff subprocess.
// No Git network, Docker or listener is accessed; the handoff order is tested below against its real function.
function fixture(
  t,
  {
    proof = false,
    alreadyIntegrated = false,
    changedFile = 'backend/src/test/java/ExampleTest.java',
    scenario = '',
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zdm-sync-integration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const integration = path.join(directory, 'integration');
  const task = path.join(directory, 'task');
  const bin = path.join(directory, 'bin');
  for (const value of [root, integration, task, bin, path.join(integration, '.task-runtime')])
    mkdirSync(value, { recursive: true });
  const stateFile = path.join(directory, 'state.json');
  const callsFile = path.join(directory, 'calls.jsonl');
  const proofFile = path.join(integration, '.task-runtime/integration-handoff-state.json');
  writeFileSync(
    stateFile,
    JSON.stringify({ sequence: 1, integrationHead: alreadyIntegrated ? 'merged-head' : 'old-head' }),
  );
  writeFileSync(callsFile, '');
  const code = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const settings = JSON.parse(process.env.ZDM_SYNC_TEST);
const state = JSON.parse(fs.readFileSync(settings.stateFile));
fs.appendFileSync(settings.callsFile, JSON.stringify({ command, args }) + '\\n');
const out = (value) => process.stdout.write(value);
const save = () => fs.writeFileSync(settings.stateFile, JSON.stringify(state));
if (command === 'git') {
  if (args[0] === 'rev-parse') {
    if (args[1] === '--show-toplevel') out(settings.root);
    else if (args[1] === 'refs/heads/codex/task') out('task-head');
    else out(state.integrationHead);
  } else if (args[0] === 'branch') out('codex/task');
  else if (args[0] === 'worktree') out('worktree ' + settings.task + '\\nHEAD task-head\\nbranch refs/heads/codex/task\\n\\nworktree ' + settings.integration + '\\nHEAD ' + state.integrationHead + '\\nbranch refs/heads/codex/integration-current\\n\\n');
  else if (args[0] === 'rev-list') out('0\\t0');
  else if (args[0] === 'merge-base') process.exit(settings.alreadyIntegrated ? 0 : 1);
  else if (args[0] === 'merge') { state.integrationHead = 'merged-head'; save(); }
  else if (args[0] === 'diff') out(settings.changedFile + '\\0');
  else if (args[0] === 'ls-tree') out(settings.tree + '\\0');
  else if (!['fetch', 'push', 'status', 'show-ref'].includes(args[0])) process.exit(90);
} else if (command === 'docker') {
  if (args[0] === 'inspect') out(JSON.stringify([${container.toString()}(settings.integration, state.sequence)]));
  else if (args.join(' ') === 'compose config --format json') out(settings.composeConfig);
  else process.exit(91);
} else if (command === 'npm') {
  if (args[1] !== 'dev:task:handoff') process.exit(92);
  if (settings.scenario === 'launch-failure' || settings.scenario === 'health-failure') { process.stderr.write(settings.scenario); process.exit(17); }
  if (args.includes('--force-integration-backend') && settings.scenario !== 'identity-unchanged') { state.sequence++; save(); }
  if (settings.scenario === 'source-changed') fs.writeFileSync(path.join(settings.integration, 'pom.xml'), 'changed during startup');
  if (settings.scenario === 'handoff-failure') process.exit(23);
  if (settings.scenario === 'handoff-identity-changed') { state.sequence++; save(); process.exit(24); }
} else process.exit(93);
`;
  for (const command of ['git', 'docker', 'npm']) {
    const executable = path.join(bin, command);
    writeFileSync(executable, code);
    chmodSync(executable, 0o755);
  }
  if (proof)
    writeFileSync(
      proofFile,
      JSON.stringify({
        version: 1,
        status: 'passed',
        integrationHead: 'old-head',
        taskHead: 'previous-task',
        sourceIdentity: integrationSourceIdentity(integration, tree),
        configurationIdentity: runtimeDigest(composeConfig),
        containerIdentity: integrationBackendIdentity(container(integration), integration),
      }),
    );
  const entrypoint = path.join(directory, 'entrypoint.mjs');
  writeFileSync(
    entrypoint,
    `import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { syncIntegration } from ${JSON.stringify(script)};
import { integrationBackendSnapshot, integrationProofMatches, readIntegrationProof, writeIntegrationProof, assertIntegrationRuntimeReady } from ${JSON.stringify(fileURLToPath(new URL('./integration-handoff-state.mjs', import.meta.url)))};
import { readFileSync, writeFileSync } from 'node:fs';
syncIntegration('codex/task', { executeHandoff(command, args, options) {
  assert.equal(command, process.execPath);
  assert.equal(args[0], ${JSON.stringify(fileURLToPath(new URL('./dev-task.mjs', import.meta.url)))});
  assert.equal(args[1], '--handoff');
  const before = integrationBackendSnapshot(options.cwd);
  const recreate = args.includes('--force-integration-backend') || !integrationProofMatches(readIntegrationProof(options.cwd), before);
  writeIntegrationProof(options.cwd, { version: 1, status: 'pending', integrationHead: before.integrationHead, taskHead: 'task-head' });
  execFileSync('npm', ['run', 'dev:task:handoff', '--', ...args.slice(2), ...(recreate && !args.includes('--force-integration-backend') ? ['--force-integration-backend'] : [])], options);
  const after = integrationBackendSnapshot(options.cwd);
  assertIntegrationRuntimeReady(before, after, { recreate });
  writeIntegrationProof(options.cwd, { version: 1, status: 'passed', taskHead: 'task-head', ...after, action: recreate ? 'recreated' : 'reused' });
  const settings = JSON.parse(process.env.ZDM_SYNC_TEST);
  if (settings.scenario === 'after-handoff-identity-changed') {
    const state = JSON.parse(readFileSync(settings.stateFile));
    state.sequence++;
    writeFileSync(settings.stateFile, JSON.stringify(state));
  }
} });`,
  );
  const settings = {
    root,
    integration,
    task,
    stateFile,
    callsFile,
    alreadyIntegrated,
    changedFile,
    scenario,
    tree,
    composeConfig,
  };
  return {
    run: (overrides = {}) =>
      spawnSync(process.execPath, [entrypoint], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin, ZDM_SYNC_TEST: JSON.stringify({ ...settings, ...overrides }) },
      }),
    calls: () =>
      readFileSync(callsFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    proof: () => JSON.parse(readFileSync(proofFile, 'utf8')),
    stateFile,
  };
}
const handoffCalls = (value) =>
  value.calls().filter(({ command, args }) => command === 'npm' && args[1] === 'dev:task:handoff');

test('backend identity rejects stale workspace, stopped service and missing startup identity', () => {
  const backend = container('/integration');
  assert.ok(integrationBackendIdentity(backend, '/integration'));
  assert.equal(integrationBackendIdentity(backend, '/other'), null);
  assert.equal(
    integrationBackendIdentity({ ...backend, State: { Running: false, StartedAt: 'old' } }, '/integration'),
    null,
  );
  assert.equal(integrationBackendIdentity({ ...backend, State: { Running: true } }, '/integration'), null);
  assert.equal(integrationProofMatches({ version: 1, status: 'pending' }, {}), false);
});

test('test-only integration reuses proven source and healthy startup across a new Git head', (t) => {
  const value = fixture(t, { proof: true });
  const result = value.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(handoffCalls(value)[0].args.includes('--force-integration-backend'), false);
  assert.equal(handoffCalls(value).length, 1);
  assert.equal(value.proof().status, 'passed');
  assert.equal(value.proof().integrationHead, 'merged-head');
  assert.match(result.stdout, /verified-reuse/);
});

test('runtime change recreates with the protected backend entrypoint', (t) => {
  const value = fixture(t, { proof: true, changedFile: 'backend/src/main/java/Service.java' });
  const result = value.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(handoffCalls(value)[0].args.includes('--force-integration-backend'), true);
  assert.equal(value.proof().status, 'passed');
  assert.match(result.stdout, /recreated-and-verified/);
});

test('already-integrated recovery requires a fresh startup once, then only rechecks valid success', (t) => {
  const value = fixture(t, { alreadyIntegrated: true });
  const first = value.run();
  assert.equal(first.status, 0, first.stderr);
  const second = value.run();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(
    handoffCalls(value).map(({ args }) => args.includes('--force-integration-backend')),
    [true, false],
  );
});

test('changed container identity invalidates a prior successful handoff', (t) => {
  const value = fixture(t, { alreadyIntegrated: true, proof: true });
  writeFileSync(value.stateFile, JSON.stringify({ sequence: 4, integrationHead: 'merged-head' }));
  const result = value.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(handoffCalls(value)[0].args.includes('--force-integration-backend'), true);
});

for (const scenario of ['launch-failure', 'health-failure', 'identity-unchanged', 'source-changed']) {
  test(`${scenario} prevents successful handoff evidence`, (t) => {
    const value = fixture(t, { alreadyIntegrated: true, scenario });
    const result = value.run();
    assert.notEqual(result.status, 0);
    assert.equal(handoffCalls(value).length, 1);
    assert.equal(value.proof().status, 'pending');
    assert.doesNotMatch(result.stdout, /任务交接：completed/);
  });
}

test('failed health check invalidates an existing proof and forces accurate recovery on retry', (t) => {
  const value = fixture(t, { alreadyIntegrated: true, proof: true, scenario: 'health-failure' });
  assert.notEqual(value.run().status, 0);
  assert.equal(value.proof().status, 'pending');
  const recovered = value.run({ scenario: '' });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(
    handoffCalls(value).map(({ args }) => args.includes('--force-integration-backend')),
    [false, true],
  );
  assert.equal(handoffCalls(value).length, 2);
});

for (const scenario of ['handoff-failure', 'handoff-identity-changed']) {
  test(`${scenario} never records success or reports delivery completed`, (t) => {
    const value = fixture(t, { alreadyIntegrated: true, scenario });
    const result = value.run();
    assert.notEqual(result.status, 0);
    assert.equal(value.proof().status, 'pending');
    assert.doesNotMatch(result.stdout, /任务交接：completed/);
  });
}

function handoffFixture({ scenario = '', foreignLock = false, force = true, proof = false } = {}) {
  const events = [];
  const before = {
    sourceIdentity: 'source',
    configurationIdentity: 'config',
    containerIdentity: 'old-start',
    integrationHead: 'merged',
    worktreeClean: true,
  };
  let snapshots = 0;
  return {
    events,
    run: () =>
      handoffDatabaseTask(
        {
          root: '/task',
          branch: 'codex/task',
          project: 'task',
          integrationRoot: '/integration',
          context: {},
          forceIntegrationBackend: force,
        },
        {
          readLock: () => ({
            project: foreignLock ? 'other' : 'task',
            branch: 'codex/task',
            backupFile: '/retained/backup.sql',
          }),
          captureGit: () => 'merged',
          contains: () => true,
          stopSupervised: async () => {
            events.push('stop-preview');
            return true;
          },
          currentPreview: async () => assert.fail('Already stopped managed preview'),
          stopBackend: () => events.push('stop-task-backend'),
          restoreBackend: async (_, { forceRecreate }) => {
            assert.equal(forceRecreate, force || !proof);
            assert.equal(events.at(-1), 'stop-task-backend');
            events.push('restore-integration');
            if (scenario === 'launch-failure' || scenario === 'health-failure') throw new Error(scenario);
            events.push('integration-healthy');
          },
          snapshot: () => {
            if (snapshots++ === 0) return before;
            events.push('verify-running-identity');
            return {
              ...before,
              containerIdentity:
                scenario === 'identity-unchanged' || (!force && proof && scenario !== 'reuse-identity-changed')
                  ? 'old-start'
                  : 'new-start',
              sourceIdentity: scenario === 'source-changed' ? 'changed' : 'source',
            };
          },
          readReceipt: () => (proof ? { version: 1, status: 'passed', taskHead: 'task', ...before } : null),
          writeReceipt: (_, receipt) => {
            if (scenario === 'receipt-write-failure' && receipt.status === 'passed')
              throw new Error('runtime proof could not be persisted');
            events.push(`proof-${receipt.status}`);
          },
          releaseLock: () => events.push('release-owned-lock'),
        },
      ),
  };
}

test('protected handoff stops the task before restoring integration and validates identity before releasing its lock', async () => {
  const value = handoffFixture();
  await value.run();
  assert.deepEqual(value.events, [
    'proof-pending',
    'stop-preview',
    'stop-task-backend',
    'restore-integration',
    'integration-healthy',
    'verify-running-identity',
    'proof-passed',
    'release-owned-lock',
  ]);
  assert.equal(parseTaskPreviewArgs(['--handoff', '--force-integration-backend']).forceIntegrationBackend, true);
});

for (const scenario of ['launch-failure', 'health-failure', 'identity-unchanged', 'source-changed']) {
  test(`protected handoff retains the database lock and backup on ${scenario}`, async () => {
    const value = handoffFixture({ scenario });
    await assert.rejects(value.run());
    assert.equal(value.events.includes('release-owned-lock'), false);
    assert.ok(value.events.indexOf('stop-task-backend') < value.events.indexOf('restore-integration'));
  });
}

test('another task database lock blocks all preview and runtime mutations', async () => {
  const value = handoffFixture({ foreignLock: true });
  await assert.rejects(value.run(), /共享数据库/);
  assert.deepEqual(value.events, []);
});

test('direct handoff without a source proof restores the backend even without an explicit force flag', async () => {
  const value = handoffFixture({ force: false });
  await value.run();
  assert.ok(value.events.includes('proof-passed'));
});

test('direct handoff with a matching healthy source proof preserves the same startup identity', async () => {
  const value = handoffFixture({ force: false, proof: true });
  await value.run();
  assert.ok(value.events.includes('proof-passed'));
});

test('container changes after handoff cannot be accepted by comparing the observed identity to itself', (t) => {
  const value = fixture(t, { alreadyIntegrated: true, scenario: 'after-handoff-identity-changed' });
  const result = value.run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /任务交接：completed/);
  assert.match(result.stderr, /不匹配交接成功证明/);
});

test('a reuse-path startup identity change invalidates health evidence and preserves the database lock', async () => {
  const value = handoffFixture({ force: false, proof: true, scenario: 'reuse-identity-changed' });
  await assert.rejects(value.run(), /复用期间启动身份变化/);
  assert.equal(value.events.includes('release-owned-lock'), false);
  assert.equal(value.events.includes('proof-passed'), false);
});

test('runtime proof write failure preserves the database lock', async () => {
  const value = handoffFixture({ scenario: 'receipt-write-failure' });
  await assert.rejects(value.run(), /could not be persisted/);
  assert.equal(value.events.includes('release-owned-lock'), false);
});
