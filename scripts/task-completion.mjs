import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDeliveryChanges, createVerificationPlan } from './verify.mjs';
import { waitRemoteQuality } from './wait-quality.mjs';
import { readActiveBatch, planBatchDelivery } from './task-batch.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const knownOutput =
  /^(?:\.task-verification\/|\.task-runtime\/|playwright-report\/|test-results\/|coverage\/|backend\/target\/|dist\/)/;
const privateInput =
  /(?:^|\/)(?:\.env(?:\.|$)|data-environment\.json$|.*(?:credential|secret|password).*|.*\.pem$|.*\.key$)/i;
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `Cannot verify Git state: ${args[0]}`);
  return args.includes('-z') ? result.stdout : result.stdout.trim();
}
export function assetKind(name, entry, root) {
  if (name === 'node_modules' && entry.isSymbolicLink()) {
    const target = realpathSync(path.join(root, name));
    return target.startsWith(path.resolve(root) + path.sep) ? 'blocked' : 'external-dependency-retained';
  }
  if (entry.isSymbolicLink() || !entry.isFile() || privateInput.test(name)) return 'blocked';
  if (knownOutput.test(name) && !realpathSync(path.join(root, name)).startsWith(realpathSync(root) + path.sep))
    return 'blocked';
  return knownOutput.test(name) ? 'generated-output' : 'blocked';
}
export function inventoryAssets(root) {
  const files = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean);
  return files.map((file) => {
    const entry = lstatSync(path.join(root, file));
    return { file, kind: assetKind(file, entry, root), bytes: entry.size };
  });
}
export function preserveAssets(root, destination, assets = inventoryAssets(root)) {
  assert.equal(
    assets.some((entry) => entry.kind === 'blocked'),
    false,
    'Unknown, private input or in-worktree dependency remains: retain worktree and resolve ownership; do not archive or delete automatically',
  );
  assert.ok(!existsSync(destination) || !lstatSync(destination).isSymbolicLink(), 'Unsafe preservation directory');
  if (existsSync(destination))
    assert.ok(
      lstatSync(destination).isDirectory() && (lstatSync(destination).mode & 0o077) === 0,
      'Preserved assets require owner-only access',
    );
  const parent = path.dirname(destination);
  assert.ok(!existsSync(parent) || !lstatSync(parent).isSymbolicLink(), 'Unsafe preservation parent');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const blobs = path.join(destination, 'blobs');
  assert.ok(!existsSync(blobs) || !lstatSync(blobs).isSymbolicLink(), 'Unsafe blob directory');
  mkdirSync(blobs, { mode: 0o700, recursive: true });
  const manifest = [];
  for (const item of assets) {
    if (item.kind === 'external-dependency-retained') {
      manifest.push(item);
      continue;
    }
    const source = path.join(root, item.file);
    assert.equal(assetKind(item.file, lstatSync(source), root), 'generated-output', 'Asset changed type');
    const bytes = readFileSync(source);
    const digest = sha(bytes);
    const blob = path.join(blobs, digest);
    if (existsSync(blob)) {
      assert.ok(lstatSync(blob).isFile() && !lstatSync(blob).isSymbolicLink(), 'Unsafe existing blob');
      assert.equal(sha(readFileSync(blob)), digest, 'Damaged preserved asset');
    } else {
      writeFileSync(blob, bytes, { flag: 'wx', mode: 0o600 });
      assert.equal(sha(readFileSync(blob)), digest, 'Preservation did not match source');
    }
    manifest.push({ ...item, bytes: bytes.length, digest });
  }
  // One manifest per distinct content state, never overwrite a prior failure/history record.
  const content = JSON.stringify(manifest, null, 2) + '\n';
  const file = path.join(destination, `assets-${sha(content)}.json`);
  if (!existsSync(file)) writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  else
    assert.ok(
      !lstatSync(file).isSymbolicLink() && readFileSync(file, 'utf8') === content,
      'Unsafe or damaged asset manifest',
    );
  return { manifest: file, files: manifest.length, sourcesRemoved: false };
}
export function previewContract(record, commonDir) {
  assert.equal(record?.version, 1, 'Missing persistent preview registration');
  assert.equal(path.resolve(record.repository), path.resolve(commonDir), 'Foreign preview registration');
  const p = record.profile;
  assert.equal(p?.status, 'ready', 'Preview data profile is not ready');
  assert.match(p.database ?? '', /^zdm_task_[a-f0-9]{16}$/);
  assert.match(p.mediaVolume ?? '', /^zdm-task-media-[a-f0-9]{16}$/);
  assert.ok(p.backupFile && existsSync(p.backupFile), 'Preview backup is unavailable');
  return {
    strategy: 'persistent-isolated',
    profileFingerprint: sha(JSON.stringify(p)),
    backupRetained: true,
    missingDataPolicy: 'stop-no-rebuild',
    unavailablePolicy: '503-no-integration-fallback',
  };
}
async function main(args) {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const commonDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  const batch = readActiveBatch(root);
  assert.ok(batch && path.resolve(batch.worktree) === root, 'Run inside the exact registered batch worktree');
  const [command = 'plan'] = args;
  assert.equal(args.length <= (command === 'wait' ? 3 : 1), true, 'Unexpected options');
  if (command === 'plan') {
    const assets = inventoryAssets(root);
    let delivery;
    try {
      delivery = planBatchDelivery(root);
    } catch (error) {
      delivery = { ready: false, reason: error.message, modules: batch.modules };
    }
    const verification = createVerificationPlan({
      root,
      affected: true,
      browser: 'chrome',
      ...collectDeliveryChanges(root),
    });
    const checks = [
      verification.preflight,
      ...verification.frontend,
      ...verification.engineering,
      ...verification.backend,
      batch.kind === 'infrastructure' ? null : verification.runtime,
    ]
      .filter(Boolean)
      .map(({ name, command, args, kind }) => ({ name, command, args, kind }));
    console.log(
      JSON.stringify(
        {
          batch: batch.id,
          kind: batch.kind,
          branch: batch.branch,
          delivery,
          verification: { impact: verification.impact, checks, finalCiRequired: true },
          assets,
          preserveTo: path.join(commonDir, 'task-assets', batch.id),
          rules: {
            localFullOnlyForRiskOrCiGap: true,
            singleCiWait: true,
            linuxOnlyForActualFailure: true,
            noAutomaticServiceRestart: true,
            preserveOnceBeforeRemoval: true,
            noDatabaseOrCacheDeletion: true,
          },
        },
        null,
        2,
      ),
    );
  } else if (command === 'preserve') {
    console.log(JSON.stringify(preserveAssets(root, path.join(commonDir, 'task-assets', batch.id)), null, 2));
  } else if (command === 'runtime') {
    const file = path.join(commonDir, 'preview-environment/environment.json');
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe preview registration');
    const result = previewContract(JSON.parse(readFileSync(file, 'utf8')), commonDir);
    for (const url of [
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080/actuator/health',
      'http://127.0.0.1:5175/__zdm_task_preview_api_health__',
    ]) {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, `Runtime unavailable: ${url}`);
      if (url.includes('health')) assert.equal((await response.json()).status, 'UP');
    }
    console.log(JSON.stringify({ ...result, runtimeHealthy: true, servicesChanged: false }, null, 2));
  } else if (command === 'wait') {
    console.log(JSON.stringify(await waitRemoteQuality(root, args[1], args[2]), null, 2));
  } else throw new Error('Usage: task:completion -- plan|preserve|runtime|wait <run-id> <expected-head>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
