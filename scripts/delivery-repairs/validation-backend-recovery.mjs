import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withIntegrationResource } from '../integration-resource.mjs';
import { createResourceLeases } from '../resource-lease.mjs';
import { readTaskData, rootSql } from '../task-data-environment.mjs';
import { assertTaskExecutor } from '../task-execution-binding.mjs';
import { createExecutionOrder } from '../task-execution-order.mjs';
import { createTaskRegistry } from '../task-registry.mjs';
import { taskProjectName } from '../dev-task.mjs';
import { readPreviewResponse, temporaryPreviewLeases } from '../preview-consumers.mjs';
import { referenceHash } from './preview-reference-history.mjs';
import { observedHostMountPath, referenceFrontendMetadata } from './preview-reference-proof-core.mjs';
import {
  createReferenceEvidenceJournal,
  observeInterruptedValidationReferences,
  readReferenceBackendHealth,
  referenceConsumerAnchor,
} from './preview-reference-proof.mjs';
import { readInterruptedValidationEvidence } from './validation-recovery-evidence.mjs';
import {
  assertMaintenanceStartup,
  readMaintenanceBackend,
  readValidationMaintenance,
  recoveryReceiptFile,
} from './validation-maintenance-lineage.mjs';

const source = fileURLToPath(import.meta.url);
export const validationRuntimeHash = (c) =>
  referenceHash(JSON.stringify([c.Id, c.Created, c.Image, c.Config, c.HostConfig, c.Mounts]));
export { recoveryReceiptFile } from './validation-maintenance-lineage.mjs';
const expectedPorts = [5175, 5176, ...Array.from({ length: 23 }, (_, i) => 5177 + i)];
export function assertRecoveryConsumers(live, evidence, worktree, now, readTask) {
  for (const key of ['task', 'port', 'backendPort']) assert.equal(live.identity[key], evidence.foreign[key]);
  assert.equal(live.rounds.length, 2);
  for (const round of live.rounds) {
    assert.ok(Number.isFinite(round.observedAt) && round.observedAt <= now && now - round.observedAt <= 60000);
    assert.deepEqual(
      round.frontendObservations.map((p) => p.port),
      expectedPorts,
    );
    assert.deepEqual(round.backendConsumers, []);
    assert.deepEqual(round.backendHealth, { statusCode: 200, status: 'UP' });
    for (const { port, response } of round.frontendObservations) {
      const lease = round.previewLeases.find((p) => p.port === port);
      if (port === evidence.foreign.port) {
        const actual = { ...lease };
        delete actual.port;
        assert.deepEqual(actual, live.identity.lease);
        assert.equal(response.errorCode, 'ECONNREFUSED');
        assert.equal(response.statusCode, 0);
        continue;
      }
      if (port === evidence.formerPort && round.reassignedClosed) {
        const identity = { ...lease };
        delete identity.port;
        assert.equal(round.reassignedClosed.port, port);
        assert.deepEqual(round.reassignedClosed.lease, identity);
        assert.notEqual(lease?.task, evidence.task);
        assert.equal(response.statusCode, 0);
        assert.equal(response.errorCode, 'ECONNREFUSED');
        continue;
      }
      const metadata = referenceFrontendMetadata(port, response, lease);
      if (port === evidence.formerPort) {
        if (lease) {
          assert.notEqual(lease.task, evidence.task);
          assert.equal(lease.resource, 'temporary-port-' + port);
          const owner = readTask(lease.task);
          assert.equal(owner.id, lease.task);
          assert.equal(owner.resources.dataScope, 'isolated-task');
          assert.ok(!owner.recovery?.runtimeBlocked);
          assert.equal(metadata?.workspaceRoot, owner.worktree, 'Reassigned preview worktree is unproven');
          assert.equal(metadata.branch, owner.branch);
          assert.equal(metadata.mode, 'full');
          assert.equal(metadata.runtimeId, lease.token, 'Reassigned preview nonce is unproven');
        } else {
          assert.equal(response.errorCode, 'ECONNREFUSED');
          assert.equal(response.statusCode, 0);
        }
      }
      if (metadata) {
        assert.notEqual(metadata.workspaceRoot, worktree, 'A validation frontend still exists');
        assert.notEqual(
          new URL(metadata.apiTarget).port,
          String(evidence.backend.port),
          'Another frontend still uses this backend',
        );
      }
    }
  }
}

function run(command, args, { status = 0, allowStderr = false, includeStderr = false } = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  assert.ok(
    !r.error && r.status === status && (allowStderr || !r.stderr.trim()),
    'Observation or stop failed: ' + command,
  );
  return (includeStderr ? [r.stdout, r.stderr].join('\n') : r.stdout).trim();
}
const docker = (...args) => run('docker', args);
const git = (root, ...args) => run('git', ['--no-optional-locks', '--no-replace-objects', '-C', root, ...args]);
export const inspectRecoveryContainer = (id) => {
  assert.match(id, /^[a-f0-9]{64}$/);
  const list = JSON.parse(docker('inspect', id));
  assert.equal(list.length, 1);
  assert.equal(list[0].Id, id);
  return list[0];
};

export function assertRecoveryContainer(
  c,
  evidence,
  { root, project, running, startedAt = evidence.backend.startedAt },
) {
  assert.equal(c.Id, evidence.backend.id);
  assert.equal(c.State.Running, running);
  assert.equal(c.State.StartedAt, startedAt);
  assert.equal(c.Config.Labels['com.docker.compose.project'], project);
  assert.equal(c.Config.Labels['com.docker.compose.service'], 'backend');
  const binds = c.Mounts.filter(
    (m) =>
      m.Type === 'bind' && m.Destination === '/workspace' && observedHostMountPath(m.Source, process.platform) === root,
  );
  assert.equal(binds.length, 1);
  assert.equal(binds[0].RW, true);
}

const health = async (port) => readReferenceBackendHealth('http://127.0.0.1:' + port + '/actuator/health');
async function requireUp(port) {
  const result = await health(port);
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).status, 'UP');
}
function published(root, common) {
  const anchor = referenceConsumerAnchor(root, common),
    base = git(anchor, 'rev-parse', 'refs/remotes/origin/main');
  assert.equal(realpathSync(source), path.join(anchor, 'scripts/delivery-repairs/validation-backend-recovery.mjs'));
  assert.equal(git(anchor, 'rev-parse', 'HEAD'), base);
  assert.equal(git(anchor, 'status', '--porcelain'), '');
  for (const name of [
    'validation-backend-recovery',
    'validation-recovery-evidence',
    'validation-maintenance-lineage',
    'validation-closed-peer',
  ]) {
    const relative = 'scripts/delivery-repairs/' + name + '.mjs';
    const r = spawnSync('git', ['--no-replace-objects', '-C', anchor, 'show', base + ':' + relative]);
    assert.equal(r.status, 0);
    assert.ok(
      r.stdout.equals(readFileSync(path.join(anchor, relative))),
      'Actual recovery source must be an exact published Git blob',
    );
  }
  return anchor;
}

async function recover(root, archive) {
  const registry = createTaskRegistry(root),
    common = registry.commonDir;
  const task = registry.resolve({ worktree: root });
  assertTaskExecutor(task);
  assert.equal(task.worktree, root);
  assert.ok(!process.env.ZDM_EXECUTION_ADMISSION && !process.env.ZDM_CLOSED_PREVIEW_REFERENCE);
  const anchor = published(root, common);
  const endpoint =
    process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT
      ? process.env.DOCKER_HOST
      : JSON.parse(docker('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'));
  assert.match(endpoint, /^unix:\/\//);
  const output = path.dirname(recoveryReceiptFile(common, task));
  const lease = createResourceLeases(common),
    project = taskProjectName({ root, branch: task.branch });
  const inspectAssets = () => {
    const data = readTaskData(root);
    assert.match(data.database, /^[a-zA-Z0-9_]+$/);
    assert.equal(
      rootSql("SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='" + data.database + "';"),
      '1',
    );
    const backup = lstatSync(data.backupFile);
    assert.ok(backup.isFile() && !backup.isSymbolicLink() && backup.size > 0);
    return { data, backup: [backup.ino, backup.size, backup.mtimeMs] };
  };
  const stableAssets = (c) => {
    const assets = inspectAssets();
    const names = c.Mounts.filter((m) => m.Type === 'volume')
      .map((m) => m.Name)
      .sort();
    assert.ok(names.includes(assets.data.mediaVolume));
    return referenceHash(JSON.stringify([assets, JSON.parse(docker('volume', 'inspect', ...names))]));
  };
  const active = () => JSON.parse(docker('inspect', ...docker('ps', '-q', '--no-trunc').split(/\s+/).filter(Boolean)));
  const exactActiveBackend = (containers, e) => {
    const selected = containers.filter(
      (c) =>
        c.Config.Labels['com.docker.compose.project'] === project &&
        c.Config.Labels['com.docker.compose.service'] === 'backend',
    );
    assert.deepEqual(
      selected.map((c) => c.Id),
      [e.backend.id],
      'Compose backend ownership must be unique',
    );
  };
  const bound = (c, port) =>
    Object.values(c.NetworkSettings.Ports ?? {})
      .flatMap((b) => b ?? [])
      .some((b) => b.HostPort === String(port));
  const others = (live, ports) =>
    ports.map((port) => {
      const found = live.filter((c) => bound(c, port));
      assert.equal(found.length, 1);
      return [port, found[0].Id, found[0].State.StartedAt, validationRuntimeHash(found[0])];
    });
  const getEvidence = () => {
    assert.ok(
      !createExecutionOrder(common)
        .read()
        .dynamicDecisions?.some((d) => d.status === 'reserved' && d.input.task === task.id),
    );
    return readInterruptedValidationEvidence(task, common, archive);
  };
  return lease.run('task-delivery-' + task.id, task.owner, () =>
    withIntegrationResource(anchor, task.id, () =>
      lease.run('task-preview-' + task.id, task.id, async () => {
        const e = getEvidence();
        assert.ok(!existsSync(output), 'Recovery already attempted; read back its durable intent');
        mkdirSync(output, { mode: 0o700 });
        const record = createReferenceEvidenceJournal(path.join(output, 'observation'));
        try {
          const maintenance = readValidationMaintenance(common, task, e);
          const startedAt = maintenance.own.live.startedAt;
          const ownRuntime = { root, project, startedAt };
          const own = inspectRecoveryContainer(e.backend.id);
          assertRecoveryContainer(own, e, { ...ownRuntime, running: true });
          const neighbor = registry.readTask(e.foreign.task);
          const checkBackend = (container, proof, runtime) => {
            const live = readMaintenanceBackend(container, proof, runtime);
            const logs = run(
              'docker',
              ['logs', '--timestamps', '--since', proof.live.startedAt, '--until', proof.finalAt, container.Id],
              { allowStderr: true, includeStderr: true },
            );
            assertMaintenanceStartup(logs, proof);
            return live;
          };
          const ownProof = checkBackend(own, maintenance.own, { root, project, port: e.backend.port });
          const foreign = inspectRecoveryContainer(e.foreign.containerId);
          const foreignRuntime = {
            root: neighbor.worktree,
            project: taskProjectName({ root: neighbor.worktree, branch: neighbor.branch }),
            port: e.foreign.backendPort,
          };
          const foreignProof = checkBackend(foreign, maintenance.foreign, foreignRuntime);
          const c = own;
          const aliases = [
            c.Name.slice(1),
            c.Id,
            ...Object.keys(c.NetworkSettings.Networks ?? {})
              .flatMap((n) => c.NetworkSettings.Networks[n].Aliases ?? [])
              .filter((name) => name !== 'backend'),
          ];
          for (const host of ['host.docker.internal', '127.0.0.1', 'localhost'])
            aliases.push(host + ':' + e.backend.port);
          const initial = active(),
            protectedPorts = [
              8080,
              e.foreign.backendPort,
              ...(maintenance.reassigned ? [maintenance.reassigned.backendPort] : []),
            ],
            shared = others(initial, protectedPorts);
          exactActiveBackend(initial, e);
          assert.ok(
            !initial
              .filter((c) => c.Id !== e.backend.id)
              .some((other) =>
                [
                  ...(other.Config.Env ?? []),
                  ...(other.Config.Cmd ?? []),
                  ...(other.Config.Entrypoint ?? []),
                  ...(other.HostConfig.Links ?? []),
                ].some((value) => aliases.some((alias) => value.includes(alias))),
              ),
            'Other container references validation backend',
          );
          const noClient = () =>
            assert.equal(
              run('/usr/sbin/lsof', ['-nP', '-iTCP:' + e.backend.port, '-sTCP:ESTABLISHED', '-t'], { status: 1 }),
              '',
            );
          noClient();
          const volumes = stableAssets(c),
            before = validationRuntimeHash(c);
          for (const p of [...protectedPorts, e.backend.port]) await requireUp(p);
          const live = await observeInterruptedValidationReferences(
            root,
            task.id,
            e.foreignProof.file,
            e.foreignProof.digest,
            { proof: maintenance.foreign, backend: foreignProof, reassigned: maintenance.reassigned },
          );
          const readTask = (id) => registry.readTask(id);
          assertRecoveryConsumers(live, e, root, Date.now(), readTask);
          assert.equal(shared.find(([port]) => port === e.foreign.backendPort)[1], live.identity.backend.id);
          assert.deepEqual(getEvidence(), e);
          const runningNow = active();
          assert.deepEqual(others(runningNow, protectedPorts), shared);
          exactActiveBackend(runningNow, e);
          const current = inspectRecoveryContainer(e.backend.id);
          assertRecoveryContainer(current, e, { ...ownRuntime, running: true });
          assert.deepEqual(
            readMaintenanceBackend(current, maintenance.own, {
              root,
              project,
              port: e.backend.port,
            }),
            ownProof,
          );
          assert.deepEqual(
            readMaintenanceBackend(
              inspectRecoveryContainer(e.foreign.containerId),
              maintenance.foreign,
              foreignRuntime,
            ),
            foreignProof,
          );
          assert.deepEqual(readValidationMaintenance(common, task, e), maintenance);
          assert.equal(validationRuntimeHash(current), before);
          assert.equal(stableAssets(current), volumes);
          assert.deepEqual(temporaryPreviewLeases(common), live.rounds.at(-1).previewLeases);
          noClient();
          assertRecoveryConsumers(live, e, root, Date.now(), readTask);
          const intent = record('stop-intent', {
            evidence: e,
            maintenance: maintenance.selectorDigest,
            startedAt,
            containerIdentity: before,
            assets: volumes,
            shared,
            observations: live.evidenceDirectory,
          });
          // Never route the archived frontend port through the task launcher. It may
          // already hold another runtime. Stop only the proven full container ID.
          assert.equal(docker('stop', e.backend.id), e.backend.id);
          const after = inspectRecoveryContainer(e.backend.id);
          assertRecoveryContainer(after, e, { ...ownRuntime, running: false });
          assert.equal(validationRuntimeHash(after), before);
          assert.equal(stableAssets(after), volumes);
          assert.deepEqual(others(active(), protectedPorts), shared);
          assert.deepEqual(temporaryPreviewLeases(common), live.rounds.at(-1).previewLeases);
          for (const p of protectedPorts) await requireUp(p);
          const beforePreviews = live.rounds.at(-1).frontendObservations;
          const afterPreviews = await Promise.all(
            beforePreviews.map(async ({ port }) => ({
              port,
              response: await readPreviewResponse(`http://127.0.0.1:${port}/__zdm_task_preview__`),
            })),
          );
          assert.deepEqual(afterPreviews, beforePreviews, 'A preview changed during backend recovery');
          assert.equal((await health(e.backend.port)).errorCode, 'ECONNREFUSED');
          assert.deepEqual(getEvidence(), e);
          assert.deepEqual(readValidationMaintenance(common, task, e), maintenance);
          const receipt = {
            evidence: e,
            maintenance: maintenance.selectorDigest,
            startedAt,
            containerIdentity: before,
            assets: volumes,
            intent,
            stoppedAt: after.State.FinishedAt,
            containerRetained: true,
          };
          record('stopped', receipt);
          writeFileSync(recoveryReceiptFile(common, task), JSON.stringify(receipt, null, 2) + '\n', {
            flag: 'wx',
            mode: 0o600,
            flush: true,
          });
          return { task: task.id, stopped: true, containerRetained: true, formalDeliveryComplete: false };
        } catch (error) {
          record('failed', { reason: error.message });
          throw error;
        }
      }),
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  assert.equal(process.argv.length, 4, 'Specify the exact worktree and preserved lease archive');
  console.log(JSON.stringify(await recover(process.argv[2], process.argv[3])));
}
