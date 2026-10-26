import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPaths } from './verification-evidence.mjs';
export const APP_DIRECTORY = '.task-runtime/e2e-app';
export const APP_PROOF = '.task-runtime/e2e-app-proof.json';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function readApplicationManifest(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'ci/e2e-app.json')));
  assert.equal(manifest.version, 1);
  const walk = (dir) =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
    );
  assert.deepEqual(
    manifest.entries,
    [
      'index.html',
      ...walk('tests/fixtures')
        .filter((file) => file.endsWith('.html'))
        .sort(),
    ],
    'Test HTML entry inventory changed',
  );
  assert.deepEqual(
    manifest.developmentCases,
    [
      {
        file: 'native-style-isolation.spec.ts',
        movedFrom: 'dialog-validation-space.spec.ts',
        title: 'pure native Dialog and Form reproduce last-field error overflow without application styles',
      },
    ],
    'Unreviewed development-only selection',
  );
  return manifest;
}
export function applicationSource(root = process.cwd()) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const files = [
    ...new Set(
      result.stdout
        .split('\0')
        .filter((file) =>
          /^(?:src\/|tests\/fixtures\/|index\.html$|package(?:-lock)?\.json$|vite(?:\.e2e)?\.config\.(?:js|mjs)$|ci\/e2e-app\.json$|scripts\/e2e-app\.mjs$)/.test(
            file,
          ),
        ),
    ),
  ].sort();
  for (const name of readdirSync(root)) if (/^\.env(?:\.|$)/.test(name)) files.push(name);
  return hashPaths(root, files);
}
export function readApplicationProof(root = process.cwd()) {
  readApplicationManifest(root);
  const proof = JSON.parse(readFileSync(path.join(root, APP_PROOF)));
  assert.equal(proof.version, 1);
  assert.equal(proof.source, applicationSource(root), 'Application source changed after build');
  assert.equal(proof.artifact, hashPaths(root, [APP_DIRECTORY]), 'Application artifact changed after build');
  assert.equal(proof.policy, hash(readFileSync(path.join(root, 'ci/e2e-app.json'))));
  return proof;
}
export function prepareApplication(root = process.cwd()) {
  readApplicationManifest(root);
  const source = applicationSource(root);
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.e2e.config.mjs'],
    { cwd: root, stdio: 'inherit' },
  );
  assert.equal(result.status, 0, 'E2E application build failed');
  assert.equal(applicationSource(root), source, 'Source changed during application build');
  const proof = {
    version: 1,
    source,
    artifact: hashPaths(root, [APP_DIRECTORY]),
    policy: hash(readFileSync(path.join(root, 'ci/e2e-app.json'))),
  };
  writeFileSync(path.join(root, APP_PROOF), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}
function port(value, fallback) {
  const n = Number(value ?? fallback);
  assert.ok(Number.isInteger(n) && (n === 5174 || n === 5194 || (n >= 5200 && n < 6000)), 'Unreviewed E2E port');
  return n;
}
export function testPorts(env = process.env) {
  const app = port(env.PLAYWRIGHT_APP_PORT, 5174),
    development = port(env.PLAYWRIGHT_DEV_PORT, 5194);
  assert.notEqual(app, development);
  return { app, development };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    assert.ok(['prepare', 'serve', 'dev'].includes(mode));
    if (mode === 'prepare') prepareApplication();
    else if (mode === 'dev') {
      mkdirSync('.task-runtime', { recursive: true });
      writeFileSync('.task-runtime/e2e-dev-process.json', JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          '--host',
          '127.0.0.1',
          '--port',
          String(testPorts().development),
          '--strictPort',
        ],
        { stdio: 'inherit' },
      );
      process.exitCode = result.status ?? 1;
    } else {
      try {
        readApplicationProof();
      } catch {
        prepareApplication();
      }
      writeFileSync('.task-runtime/e2e-app-process.json', JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      const { app } = testPorts();
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          'preview',
          '--config',
          'vite.e2e.config.mjs',
          '--host',
          '127.0.0.1',
          '--port',
          String(app),
          '--strictPort',
        ],
        { stdio: 'inherit' },
      );
      process.exitCode = result.status ?? 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
