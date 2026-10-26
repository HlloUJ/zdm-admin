import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  readApplicationManifest,
  applicationSource,
  readApplicationProof,
  testPorts,
  APP_DIRECTORY,
  APP_PROOF,
} from './e2e-app.mjs';
import { hashPaths } from './verification-evidence.mjs';
import { parseProcessStat, processRoles, createResourceCollector } from './e2e-resources.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-app-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['ci', 'tests/fixtures', 'src', APP_DIRECTORY])
    mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(
    path.join(root, 'ci/e2e-app.json'),
    JSON.stringify({
      version: 1,
      entries: ['index.html', 'tests/fixtures/origin.html'],
      developmentCases: [
        {
          file: 'native-style-isolation.spec.ts',
          movedFrom: 'dialog-validation-space.spec.ts',
          title: 'pure native Dialog and Form reproduce last-field error overflow without application styles',
        },
      ],
    }),
  );
  for (const file of ['index.html', 'tests/fixtures/origin.html', 'src/app.ts'])
    writeFileSync(path.join(root, file), 'source');
  writeFileSync(path.join(root, APP_DIRECTORY, 'index.html'), 'built');
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  const proof = {
    version: 1,
    source: applicationSource(root),
    artifact: hashPaths(root, [APP_DIRECTORY]),
    policy: createHash('sha256')
      .update(readFileSync(path.join(root, 'ci/e2e-app.json')))
      .digest('hex'),
  };
  writeFileSync(path.join(root, APP_PROOF), JSON.stringify(proof));
  return root;
}
test('entry inventory and actual source/artifact bytes fail closed on additions or tampering', (t) => {
  const root = fixture(t);
  readApplicationManifest(root);
  readApplicationProof(root);
  writeFileSync(path.join(root, APP_DIRECTORY, 'index.html'), 'tampered');
  assert.throws(() => readApplicationProof(root), /artifact/);
  writeFileSync(path.join(root, APP_DIRECTORY, 'index.html'), 'built');
  writeFileSync(path.join(root, '.env.local'), 'VITE_PUBLIC_VALUE=changed');
  assert.throws(() => readApplicationProof(root), /source/);
  writeFileSync(path.join(root, 'src/app.ts'), 'new source');
  assert.throws(() => readApplicationProof(root), /source/);
  writeFileSync(path.join(root, 'tests/fixtures/new.html'), 'new fixture');
  assert.throws(() => readApplicationManifest(root), /inventory/);
});
test('ports cannot collide with each other or protected preview and integration ports', () => {
  assert.deepEqual(testPorts({}), { app: 5174, development: 5194 });
  assert.deepEqual(testPorts({ PLAYWRIGHT_APP_PORT: '5291', PLAYWRIGHT_DEV_PORT: '5292' }), {
    app: 5291,
    development: 5292,
  });
  for (const value of ['5173', '5175', '5176', 'NaN']) assert.throws(() => testPorts({ PLAYWRIGHT_APP_PORT: value }));
  assert.throws(() => testPorts({ PLAYWRIGHT_APP_PORT: '5291', PLAYWRIGHT_DEV_PORT: '5291' }));
});
test('resource roles stay within this runner, distinguish servers and browsers, and handle PID reuse', () => {
  const rows = [
    { pid: 1, ppid: 0, name: 'runner', ticks: 0, start: '1', rssPages: 1 },
    { pid: 2, ppid: 1, name: 'node', ticks: 10, start: '2', rssPages: 2 },
    { pid: 3, ppid: 2, name: 'node', ticks: 20, start: '3', rssPages: 3 },
    { pid: 4, ppid: 1, name: 'node', ticks: 5, start: '4', rssPages: 4 },
    { pid: 5, ppid: 4, name: 'chrome', ticks: 30, start: '5', rssPages: 5 },
    { pid: 6, ppid: 0, name: 'unrelated-private-name', ticks: 99, start: '6', rssPages: 99 },
  ];
  const selected = processRoles(rows, 1, [2]);
  assert.deepEqual(
    selected.map((p) => p.role),
    ['server', 'server', 'worker', 'browser'],
  );
  let ticks = 0;
  const collector = createResourceCollector({
    read: () => selected.map((p) => ({ ...p, ticks: p.ticks + ticks })),
    ticksPerSecond: 100,
    pageSize: 4096,
  });
  ticks = 10;
  const result = collector.stop();
  assert.equal(result.roles.server.cpuMs, 200);
  assert.equal(result.roles.browser.cpuMs, 100);
  assert.ok(!JSON.stringify(result).includes('unrelated-private-name'));
  const stat = '42 (node) S 1 0 0 0 0 0 0 0 0 0 100 50 0 0 0 0 0 0 123 0 8';
  assert.equal(parseProcessStat(stat).pid, 42);
});
