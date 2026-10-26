import { validateBackendProof, currentBackendProof } from './ci-backend-equivalence.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import {
  imageIdentity,
  readImageLock,
  verifyImageRuntime,
  runtimeIsolation,
  validateIsolation,
} from './ci-browser-image.mjs';
import { readShardPlan } from './e2e-shards.mjs';
import { hashPaths } from './verification-evidence.mjs';

export const JOB_ENVIRONMENT_CONTRACTS = {
  formatting: 'formatting-node-v2',
  frontend_static: 'frontend-static-linux-v2',
  frontend_e2e_1: 'browser-functional-container-v4',
  frontend_e2e_2: 'browser-functional-container-v4',
};
const RESOURCE_PROFILE = 'github-hosted-linux-x64-4cpu-16gb-functional-v1';
const sha = (value) => createHash('sha256').update(value).digest('hex');
export function executionEnvironment(env) {
  // Retain the reviewed child-process environment; never pass event identities or API tokens.
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key]) =>
        /^(?:PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_ALL|TZ|DISPLAY|CI|CI_BROWSER_IMAGE|GITHUB_ACTIONS|CI_EVIDENCE_DIR|XDG_.*|PLAYWRIGHT_.*|VITE_.*|VITEST_.*|NODE_.*|NPM_CONFIG_.*)$/.test(
          key,
        ),
      )
      .sort(),
  );
}
function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${program} environment identity unavailable`);
  return result.stdout.trim();
}
export function environmentObservation() {
  return { logicalCpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, totalMemoryBytes: os.totalmem() };
}
export function validateEnvironmentProof(proof, job) {
  if (job === 'backend_full') return validateBackendProof(proof);
  assert.ok(JOB_ENVIRONMENT_CONTRACTS[job], 'Unsupported environment contract');
  assert.equal(
    proof?.version,
    job.startsWith('frontend_e2e') ? 4 : 2,
    'Old or unknown environment contract cannot grant reuse',
  );
  assert.equal(proof.contract, JOB_ENVIRONMENT_CONTRACTS[job]);
  assert.equal(proof.job, job);
  assert.deepEqual(proof.platform, ['linux', 'x64', 'ubuntu24']);
  assert.equal(proof.resources, RESOURCE_PROFILE);
  const browser = job.startsWith('frontend_e2e');
  const system = job !== 'formatting';
  const keys = [
    'version',
    'contract',
    'job',
    'platform',
    'resources',
    'node',
    'inputs',
    'environment',
    ...(system ? ['image', 'kernel', 'packages', 'systemFiles'] : []),
    ...(browser ? ['browser', 'container', 'sharding'] : []),
  ];
  assert.deepEqual(Object.keys(proof).sort(), keys.sort(), 'Missing or unreviewed proof fields');
  assert.ok(Array.isArray(proof.node) && proof.node.length === 2);
  assert.match(proof.node[0], /^v22\.\d+\.\d+$/);
  for (const value of [
    proof.node[1],
    proof.inputs,
    proof.environment,
    ...(system ? [proof.packages, proof.systemFiles] : []),
    ...(browser ? [proof.browser, proof.sharding] : []),
  ])
    assert.match(value ?? '', /^[a-f0-9]{64}$/);
  if (browser) {
    assert.deepEqual(Object.keys(proof.container).sort(), ['image', 'origin']);
    assert.match(proof.container.image, /^ghcr\.io\/hllouj\/zdm-admin-browser@sha256:[a-f0-9]{64}$/);
    assert.match(proof.container.origin, /^[a-f0-9]{64}$/);
    assert.equal(proof.image[1], proof.container.image);
  }
  if (system) {
    assert.ok(Array.isArray(proof.image) && proof.image.length === 2 && proof.image.every(Boolean));
    assert.equal(proof.image[0], 'ubuntu24');
    assert.ok(typeof proof.kernel === 'string' && proof.kernel.length > 0);
  }
  return true;
}
export function environmentProofFromSnapshot(job, snapshot) {
  assert.ok(JOB_ENVIRONMENT_CONTRACTS[job], 'This domain has no reviewed equivalence contract');
  assert.equal(snapshot.runnerEnvironment, 'github-hosted', 'Only reviewed hosted runners support reuse');
  assert.equal(snapshot.platform, 'linux');
  assert.equal(snapshot.arch, 'x64');
  assert.equal(snapshot.imageOS, 'ubuntu24');
  // Functional checks have no CPU-model or exact-capacity acceptance criterion.
  // Keep the existing four-core runner class (including automatic unit-test concurrency),
  // and require at least the advertised 16 GB; raw observations remain diagnostic only.
  assert.equal(snapshot.hardware.logicalCpus, 4, 'Unreviewed CPU resource class');
  assert.ok(
    Number.isSafeInteger(snapshot.hardware.totalMemoryBytes) && snapshot.hardware.totalMemoryBytes >= 16_000_000_000,
    'Insufficient runner memory',
  );
  const system = job !== 'formatting';
  const browser = job.startsWith('frontend_e2e');
  const proof = {
    version: browser ? 4 : 2,
    contract: JOB_ENVIRONMENT_CONTRACTS[job],
    job,
    platform: [snapshot.platform, snapshot.arch, snapshot.imageOS],
    resources: RESOURCE_PROFILE,
    node: snapshot.node,
    inputs: snapshot.inputs,
    environment: snapshot.environment,
    ...(system
      ? {
          image: [snapshot.imageOS, snapshot.imageVersion],
          kernel: snapshot.kernel,
          packages: snapshot.packages,
          systemFiles: snapshot.systemFiles,
        }
      : {}),
    ...(browser ? { browser: snapshot.browser, container: snapshot.container, sharding: snapshot.sharding } : {}),
  };
  validateEnvironmentProof(proof, job);
  return proof;
}
export function environmentProof(env = process.env) {
  assert.equal(env.GITHUB_RUN_ATTEMPT, '1', 'Reruns cannot reuse evidence');
  const job = env.GITHUB_JOB;
  if (job === 'backend_full') return currentBackendProof(env.CI_EVIDENCE_DIR ?? 'coverage/ci-evidence', env);
  assert.ok(JOB_ENVIRONMENT_CONTRACTS[job], 'This domain has no reviewed equivalence contract');
  assert.equal(
    command('git', ['status', '--porcelain', '--untracked-files=normal']),
    '',
    'Sources changed during setup',
  );
  const system = job !== 'formatting';
  const browser = job.startsWith('frontend_e2e');
  let container;
  if (browser) {
    assert.ok(existsSync('/opt/google/chrome/chrome'), 'Actual Chrome runtime cannot be proven');
    const lock = readImageLock();
    validateIsolation(runtimeIsolation());
    verifyImageRuntime(lock, env);
    container = imageIdentity(lock);
  }
  return environmentProofFromSnapshot(job, {
    runnerEnvironment: env.RUNNER_ENVIRONMENT,
    platform: process.platform,
    arch: process.arch,
    imageOS: browser ? 'ubuntu24' : env.ImageOS,
    imageVersion: browser ? container.image : env.ImageVersion,
    hardware: environmentObservation(),
    node: [process.version, sha(readFileSync(process.execPath))],
    inputs: hashPaths(process.cwd(), ['node_modules'], { dependency: true }),
    environment: sha(JSON.stringify(executionEnvironment(env))),
    ...(system
      ? {
          kernel: os.release(),
          packages: sha(command('dpkg-query', ['-W', '-f=${Package}=${Version}\n'])),
          systemFiles: hashPaths(
            '/',
            browser ? ['/etc/os-release', '/etc/fonts', '/usr/share/fonts'] : ['/etc/os-release'],
          ),
        }
      : {}),
    ...(browser
      ? { browser: hashPaths('/', ['/opt/google/chrome']), container, sharding: readShardPlan(process.cwd()).digest }
      : {}),
  });
}
