import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateImageLock, verifyImageRuntime, imageIdentity, validateIsolation } from './ci-browser-image.mjs';
import {
  executionEnvironment,
  environmentProofFromSnapshot,
  validateEnvironmentProof,
} from './ci-equivalence-environment.mjs';
const hash = 'a'.repeat(64),
  image = `ghcr.io/hllouj/zdm-admin-browser@sha256:${hash}`;
const packages = { packages: { 'node_modules/playwright': { version: '1.63.0' } } };
const fixture = () => ({
  version: 1,
  image,
  origin: {
    version: 1,
    sourceRevision: 'b'.repeat(40),
    sourceRun: 'https://github.com/HlloUJ/zdm-admin/actions/runs/123',
    ubuntuBase: `ubuntu:24.04@sha256:${hash}`,
    nodeBase: `node:22-bookworm-slim@sha256:${hash}`,
    inventory: {
      os: 'ubuntu-24.04',
      platform: 'linux/amd64',
      node: 'v22.23.4',
      chrome: 'Google Chrome 156.0.8078.47',
      chromePackage: 'install ok installed|156.0.8078.47-1',
      playwright: '1.63.0',
      ...Object.fromEntries(
        ['nodeSha256', 'packages', 'osRelease', 'fonts', 'fontConfig', 'browser'].map((k) => [k, hash]),
      ),
    },
  },
});
test('release requires immutable same-repository origin, Ubuntu24, Node22, branded Chrome and complete inventory', () => {
  assert.equal(validateImageLock(fixture(), packages).image, image);
  for (const mutate of [
    (l) => (l.image = 'ghcr.io/hllouj/zdm-admin-browser:latest'),
    (l) => (l.image = l.image.replace('hllouj', 'other')),
    (l) => (l.origin.sourceRun = 'https://example.com/123'),
    (l) => (l.origin.sourceRevision = 'main'),
    (l) => (l.origin.inventory.os = 'ubuntu-26.04'),
    (l) => (l.origin.inventory.node = 'v24.1.0'),
    (l) => (l.origin.inventory.chrome = 'Chromium 156.0.8078.47'),
    (l) => {
      l.origin.inventory.chrome = 'Google Chrome 155.0.8059.39';
      l.origin.inventory.chromePackage = 'install ok installed|155.0.8059.39-1';
    },
    (l) => (l.origin.inventory.chromePackage = 'mismatch'),
    (l) => (l.origin.inventory.playwright = '1.62.0'),
    (l) => delete l.origin.inventory.fonts,
    (l) => delete l.origin.inventory.packages,
  ]) {
    const lock = fixture();
    mutate(lock);
    assert.throws(() => validateImageLock(lock, packages));
  }
});
test('actual runtime must match both selected digest and every recorded source/inventory field', () => {
  const lock = fixture();
  assert.equal(verifyImageRuntime(lock, { CI_BROWSER_IMAGE: image }, () => lock.origin).image, image);
  assert.throws(() => verifyImageRuntime(lock, { CI_BROWSER_IMAGE: image + hash }, () => lock.origin));
  for (const key of Object.keys(lock.origin.inventory)) {
    const actual = structuredClone(lock.origin);
    actual.inventory[key] = 'changed';
    assert.throws(() => verifyImageRuntime(lock, { CI_BROWSER_IMAGE: image }, () => actual), key);
  }
  const actual = structuredClone(lock.origin);
  actual.sourceRevision = 'c'.repeat(40);
  assert.throws(() => verifyImageRuntime(lock, { CI_BROWSER_IMAGE: image }, () => actual));
});
test('container contracts reject VM evidence and changes to digest, origin, packages, fonts or browser', () => {
  const container = imageIdentity(fixture());
  const base = {
    runnerEnvironment: 'github-hosted',
    platform: 'linux',
    arch: 'x64',
    imageOS: 'ubuntu24',
    imageVersion: image,
    container,
    hardware: { logicalCpus: 4, totalMemoryBytes: 16_766_414_848 },
    node: ['v22.23.4', hash],
    inputs: hash,
    environment: hash,
    kernel: 'kernel',
    packages: hash,
    systemFiles: hash,
    browser: hash,
    sharding: hash,
    application: hash,
  };
  const proof = environmentProofFromSnapshot('frontend_e2e_1', base);
  assert.equal(proof.version, 5);
  assert.throws(() =>
    validateEnvironmentProof({ ...proof, version: 4, contract: 'browser-functional-container-v4' }, 'frontend_e2e_1'),
  );
  assert.throws(() =>
    validateEnvironmentProof({ ...proof, version: 2, contract: 'browser-functional-linux-v2' }, 'frontend_e2e_1'),
  );
  for (const key of ['packages', 'systemFiles', 'browser', 'application', 'kernel']) {
    const changed = { ...base, [key]: key === 'kernel' ? 'other' : 'b'.repeat(64) };
    assert.notDeepEqual(environmentProofFromSnapshot('frontend_e2e_1', changed), proof);
  }
  assert.throws(() => environmentProofFromSnapshot('frontend_e2e_1', { ...base, container: undefined }));
  const other = structuredClone(base);
  other.container.origin = 'e'.repeat(64);
  assert.notDeepEqual(environmentProofFromSnapshot('frontend_e2e_1', other), proof);
  const digest = structuredClone(base);
  digest.imageVersion = digest.container.image = image.replace(hash, 'd'.repeat(64));
  assert.notDeepEqual(environmentProofFromSnapshot('frontend_e2e_1', digest), proof);
});
test('image publisher stays separate from quality and cannot publish from PR events', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-image.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /pull_request|pull_request_target|workflow_call|schedule:/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /linux\/amd64/);
  assert.match(workflow, /cold_pull:/);
  assert.match(workflow, /docker pull "\$IMAGE"/);
  const quality = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(quality, /packages: write|docker build|browser-image\.yml/);
});

test('both shards select the same locked image once and keep preparation phase order', () => {
  const text = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  for (const job of ['frontend_e2e_1', 'frontend_e2e_2']) {
    const section = text.split(`  ${job}:\n`)[1].split(/\n {2}[a-z0-9_]+:\n/)[0];
    assert.equal((section.match(/CI_BROWSER_IMAGE:/g) || []).length, 1);
    assert.equal((section.match(/run browser-image --/g) || []).length, 1);
    assert.match(section, /runs-on: ubuntu-24\.04/);
    assert.match(section, /image: \$\{\{ needs\.scope\.outputs\.browser_image \}\}/);
    assert.doesNotMatch(section, /actions\/setup-node/);
    assert.match(section, /LANG: C\.UTF-8/);
    assert.match(section, /LC_ALL: C\.UTF-8/);
  }
});

test('reviewed image identity reaches preparation child processes while tokens stay excluded', () => {
  assert.deepEqual(
    executionEnvironment({ CI_BROWSER_IMAGE: image, GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', CI: 'true' }),
    { CI: 'true', CI_BROWSER_IMAGE: image },
  );
});

test('image construction uses exactly the repository locked Playwright dependency group', () => {
  const root = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  const tools = JSON.parse(readFileSync(new URL('../ci/browser-image/package-lock.json', import.meta.url)));
  for (const name of ['playwright', 'playwright-core']) {
    assert.equal(tools.packages[`node_modules/${name}`].version, root.packages[`node_modules/${name}`].version);
    assert.equal(tools.packages[`node_modules/${name}`].integrity, root.packages[`node_modules/${name}`].integrity);
  }
});

test('container isolation fails closed for root, added capabilities, privilege escalation or Docker socket access', () => {
  const value = {
    uid: 1001,
    gid: 1001,
    capabilities: '0000000000000000',
    noNewPrivileges: '1',
    dockerSocketAccessible: false,
  };
  assert.deepEqual(validateIsolation(value), value);
  for (const change of [
    { uid: 0 },
    { gid: 0 },
    { capabilities: '0000000000000001' },
    { noNewPrivileges: '0' },
    { dockerSocketAccessible: true },
  ])
    assert.throws(() => validateIsolation({ ...value, ...change }));
  const text = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  assert.equal((text.match(/--user 1001:1001 --cap-drop=ALL --security-opt=no-new-privileges/g) || []).length, 2);
});
