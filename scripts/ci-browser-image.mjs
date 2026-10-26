// One reviewed origin record for scope, runtime identity and evidence; no mutable tags.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, MINIMUM_CHROME_VERSION } from './ci-chrome-preparation.mjs';
export const IMAGE_LOCK = 'ci/browser-image.lock.json';
export function validateImageLock(lock, packageLock) {
  assert.equal(lock?.version, 1);
  assert.match(lock.image ?? '', /^ghcr\.io\/hllouj\/zdm-admin-browser@sha256:[a-f0-9]{64}$/);
  const origin = lock.origin;
  assert.equal(origin?.version, 1);
  assert.match(origin.sourceRevision ?? '', /^[a-f0-9]{40}$/);
  assert.match(origin.sourceRun ?? '', /^https:\/\/github.com\/HlloUJ\/zdm-admin\/actions\/runs\/\d+$/);
  assert.match(origin.ubuntuBase ?? '', /^ubuntu:24\.04@sha256:[a-f0-9]{64}$/);
  assert.match(origin.nodeBase ?? '', /^node:22-bookworm-slim@sha256:[a-f0-9]{64}$/);
  const item = origin.inventory;
  assert.equal(item?.os, 'ubuntu-24.04');
  assert.equal(item.platform, 'linux/amd64');
  assert.match(item.node ?? '', /^v22\.\d+\.\d+$/);
  const version = /^Google Chrome (\d+\.\d+\.\d+\.\d+)(?:\s.*)?$/.exec(item.chrome ?? '')?.[1];
  assert.ok(version, 'Official Chrome required');
  assert.ok(compareVersions(version, MINIMUM_CHROME_VERSION) >= 0, 'Image below delivered Chrome baseline');
  assert.equal(item.chromePackage, `install ok installed|${version}-1`);
  assert.equal(
    item.playwright,
    packageLock.packages['node_modules/playwright'].version,
    'Refresh image for changed Playwright dependencies',
  );
  for (const key of ['nodeSha256', 'packages', 'osRelease', 'fonts', 'fontConfig', 'browser'])
    assert.match(item[key] ?? '', /^[a-f0-9]{64}$/);
  return lock;
}
export function readImageLock(root = process.cwd()) {
  return validateImageLock(
    JSON.parse(readFileSync(path.join(root, IMAGE_LOCK))),
    JSON.parse(readFileSync(path.join(root, 'package-lock.json'))),
  );
}
export function imageIdentity(lock) {
  return { image: lock.image, origin: createHash('sha256').update(JSON.stringify(lock.origin)).digest('hex') };
}
export function validateIsolation(value) {
  assert.equal(value.uid, 1001, 'Test container must run as the unprivileged runner user');
  assert.equal(value.gid, 1001);
  assert.equal(value.capabilities, '0000000000000000', 'Container capabilities must be dropped');
  assert.equal(value.noNewPrivileges, '1');
  assert.equal(value.dockerSocketAccessible, false, 'Test processes must not access the hosted Docker socket');
  return value;
}
export function runtimeIsolation() {
  const status = readFileSync('/proc/self/status', 'utf8');
  let dockerSocketAccessible = false;
  if (existsSync('/var/run/docker.sock')) {
    try {
      accessSync('/var/run/docker.sock', constants.R_OK | constants.W_OK);
      dockerSocketAccessible = true;
    } catch (error) {
      assert.equal(error.code, 'EACCES');
    }
  }
  return {
    uid: process.getuid(),
    gid: process.getgid(),
    capabilities: /^CapEff:\s+(\S+)$/m.exec(status)?.[1],
    noNewPrivileges: /^NoNewPrivs:\s+(\S+)$/m.exec(status)?.[1],
    dockerSocketAccessible,
  };
}
export function verifyImageRuntime(
  lock,
  env = process.env,
  inspect = () =>
    JSON.parse(
      execFileSync(process.execPath, ['/opt/zdm-tools/inventory.mjs', 'verify'], { encoding: 'utf8', timeout: 60000 }),
    ),
) {
  assert.equal(env.CI_BROWSER_IMAGE, lock.image, 'Executed image differs from reviewed digest');
  const actual = inspect();
  assert.deepEqual(actual, lock.origin, 'Container origin or installed toolchain differs from release record');
  return { version: 1, ...imageIdentity(lock), sourceRun: actual.sourceRun, sourceRevision: actual.sourceRevision };
}
export function main(args) {
  assert.equal(args.length, 1);
  const lock = readImageLock();
  if (args[0] === 'resolve') {
    assert.ok(process.env.GITHUB_OUTPUT);
    appendFileSync(process.env.GITHUB_OUTPUT, `browser_image=${lock.image}\n`);
  } else {
    assert.equal(args[0], 'verify');
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    const isolation = validateIsolation(runtimeIsolation());
    const result = { ...verifyImageRuntime(lock), isolation };
    writeFileSync(path.join(process.env.CI_EVIDENCE_DIR, 'browser-image.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
