import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { servicePaths } from './task-preview-service.mjs';
import { taskProjectName, parseTaskPreviewMetadata } from './dev-task.mjs';
import { taskBackendContainerIdentity, taskBackendSourceIdentity } from './task-runtime-state.mjs';
import { createTaskRegistry } from './task-registry.mjs';
import { checkDeliveryMigrationSafety, checkTaskDataMigrations } from './delivery-migration-safety.mjs';
import { assertPreviewWriter } from './task-data-environment.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function capture(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(
    result.status,
    0,
    `Read-only ${command} ${args[0]} failed (${result.error?.code ?? result.status}); original source retained`,
  );
  return result.stdout.trim();
}
function request(options) {
  return new Promise((resolve, reject) => {
    const req = http.get(options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (bytes) => {
        body += bytes;
        if (body.length > 1024 * 1024) req.destroy(Error('Oversized probe'));
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    req.setTimeout(5000, () => req.destroy(Error('Read-only health probe timed out')));
    req.on('error', reject);
  });
}
export async function hostPreflight(root) {
  root = realpathSync(root);
  const git = (...args) => capture(root, 'git', args),
    paths = servicePaths();
  const report = {
    version: 1,
    operation: 'parallel-upgrade-preflight-only',
    at: new Date().toISOString(),
    changesApplied: false,
  };
  try {
    report.main = {
      local: git('rev-parse', 'main'),
      tracking: git('rev-parse', 'origin/main'),
      status: git('status', '--porcelain'),
    };
    const remote = git('ls-remote', 'origin', 'refs/heads/main');
    assert.match(remote, /^[a-f0-9]{40}\s+refs\/heads\/main$/);
    report.main.live = remote.split(/\s/)[0];
    assert.equal(report.main.local, report.main.tracking, 'Local/tracking main differ');
    assert.equal(report.main.live, report.main.local, 'Remote main advanced; review that exact source before applying');
    assert.equal(report.main.status, '', 'Main source is dirty');
    const legacy = createTaskRegistry(root).inspectLegacy();
    report.legacy = {
      id: legacy.record?.id,
      recordDigest: legacy.recordDigest,
      frozen: legacy.frozen,
      acceptanceDigest: legacy.acceptanceDigest,
    };
    const installed = JSON.parse(readFileSync(paths.configFile));
    report.installed = {
      serviceDigest: digest(readFileSync(paths.runtimeScript)),
      launcherDigest: digest(readFileSync(installed.launcherPath)),
    };
    const statusResponse = await request({ socketPath: paths.socketFile, path: '/status' });
    assert.equal(statusResponse.statusCode, 200);
    const status = JSON.parse(statusResponse.body);
    report.preview = Object.fromEntries(
      [
        'phase',
        'worktree',
        'servicePid',
        'childPid',
        'selectionRevision',
        'stopOwnershipProtocol',
        'retainedHandoffProtocol',
        'taskSelectionProtocol',
      ].map((key) => [key, status[key] ?? null]),
    );
    assert.equal(status.phase, 'running', 'Current preview is not running');
    const a = path.resolve(root, '../管理后台-worktrees/payment-config-cleanup');
    assert.equal(realpathSync(status.worktree), realpathSync(a), 'Preview selection changed; retain its actual owner');
    const branch = capture(a, 'git', ['branch', '--show-current']);
    assert.equal(branch, 'codex/payment-config-cleanup');
    report.taskA = {
      worktree: a,
      branch,
      head: capture(a, 'git', ['rev-parse', 'HEAD']),
      status: capture(a, 'git', ['status', '--porcelain']),
    };
    const metadataResponse = await request('http://127.0.0.1:5175/__zdm_task_preview__');
    assert.equal(metadataResponse.statusCode, 200);
    const metadata = parseTaskPreviewMetadata(metadataResponse.body);
    assert.equal(metadata?.workspaceRoot, a);
    assert.equal(metadata.branch, branch);
    assert.equal(metadata.mode, 'full');
    const api = new URL(metadata.apiTarget);
    assert.equal(api.hostname, '127.0.0.1');
    const backendPort = Number(api.port);
    assert.ok(backendPort >= 8081 && backendPort <= 8099);
    report.taskA.api = metadata.apiTarget;
    const common = realpathSync(path.resolve(root, git('rev-parse', '--git-common-dir')));
    const registration = JSON.parse(readFileSync(path.join(common, 'preview-environment/environment.json'))),
      profile = registration.profile;
    assert.equal(registration.repository, common);
    assert.equal(profile.status, 'ready');
    assert.ok(existsSync(profile.backupFile));
    report.data = { profileDigest: digest(JSON.stringify(profile)), backupRetained: true };
    const project = taskProjectName({ root: a, branch }),
      migrationDirectory = path.join(tmpdir(), 'zdm-task-preview', project, 'migrations');
    const ids = capture(root, 'docker', [
      'ps',
      '--filter',
      'label=com.docker.compose.project=' + project,
      '--filter',
      'label=com.docker.compose.service=backend',
      '--format',
      '{{.ID}}',
    ])
      .split(/\s+/)
      .filter(Boolean);
    assert.equal(ids.length, 1, 'Exact selected backend container required');
    const containers = JSON.parse(capture(root, 'docker', ['inspect', ...ids]));
    const identity = taskBackendContainerIdentity(containers[0], {
      root: a,
      project,
      backendPort,
      migrationDirectory,
      database: profile.database,
      username: profile.username,
      mediaVolume: profile.mediaVolume,
    });
    assert.ok(identity, 'Current preview API/data/container binding is not proved');
    const record = JSON.parse(readFileSync(path.join(a, '.task-runtime/backend-state.json')));
    report.taskA.recordedContainerMatches = record.containerIdentity === identity;
    assert.equal(
      report.taskA.recordedContainerMatches,
      true,
      'Recorded source generation belongs to another container boot',
    );
    report.taskA.loadedSourceMatches =
      record.sourceIdentity === taskBackendSourceIdentity({ root: a, migrationDirectory });
    assert.equal(report.taskA.loadedSourceMatches, true, 'Running A source generation changed; preserve it for review');
    report.data.containerBindingMatched = true;
    assertPreviewWriter(profile, project);
    report.data.writerOwnershipMatched = true;
    report.migrations = {
      published: checkDeliveryMigrationSafety(root),
      selected: checkTaskDataMigrations(a, profile),
    };
    const urls = [
      'http://127.0.0.1:5173/',
      'http://127.0.0.1:8080/actuator/health',
      'http://127.0.0.1:5175/__zdm_task_preview_api_health__',
    ];
    report.health = [];
    for (const url of urls) {
      const response = await request(url);
      assert.equal(response.statusCode, 200, 'Health probe failed: ' + url);
      if (url.includes('health')) assert.equal(JSON.parse(response.body).status, 'UP');
      report.health.push({ url, healthy: true });
    }
    report.preflightPassed = true;
  } catch (error) {
    report.preflightPassed = false;
    report.failure = error.message;
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 && args[0] === '--root', 'parallel-upgrade-preflight --root <exact main path>');
  const root = realpathSync(args[1]),
    report = await hostPreflight(root);
  const file = path.join(root, '.task-runtime/preview-recovery/parallel-host-preflight.json'),
    temporary = file + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
  console.log(JSON.stringify(report, null, 2));
  console.log('只读现场检查已保存：' + file);
  process.exitCode = report.preflightPassed ? 0 : 1;
}
