import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withIntegrationResource, integrationChildEnvironment } from './integration-resource.mjs';
import { createResourceLeases } from './resource-lease.mjs';
import { finalHandoff } from './completion-handoff.mjs';
import { ensureIntegrationDatabase } from './dev-task.mjs';
import { ensureBackend } from './backend-runtime.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'integration-operation-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  return { root, common: path.join(root, '.git'), leases: createResourceLeases(path.join(root, '.git')) };
}
test('one scope spans awaited work, nests without releasing it, and refuses a competing operation', async (t) => {
  const f = fixture(t);
  await withIntegrationResource(f.root, 'data-copy', async (lease) => {
    await Promise.resolve();
    assert.deepEqual(f.leases.inspect('integration-5173'), lease);
    withIntegrationResource(f.root, 'nested-helper', (nested) => assert.deepEqual(nested, lease));
    assert.throws(() => f.leases.acquire('integration-5173', 'other-task'), /owned/);
    assert.deepEqual(f.leases.inspect('integration-5173'), lease);
  });
  assert.equal(f.leases.inspect('integration-5173'), null);
  await assert.rejects(
    withIntegrationResource(f.root, 'failed-copy', async () => {
      throw Error('original failure');
    }),
    /original failure/,
  );
  assert.equal(f.leases.inspect('integration-5173'), null);
});
test('real child processes borrow only the exact direct-parent operation and never release its lease', (t) => {
  const f = fixture(t),
    url = new URL('./integration-resource.mjs', import.meta.url).href;
  const code = `const {withIntegrationResource,integrationChildEnvironment}=await import(process.argv[1]);
    withIntegrationResource(process.argv[2],'child',lease=>{if(lease.pid===process.pid)throw Error('child stole lease');
      console.log(JSON.stringify(lease));});`;
  withIntegrationResource(f.root, 'formal-handoff', (lease) => {
    const env = integrationChildEnvironment();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, url, f.root], {
      env,
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), lease);
    assert.deepEqual(f.leases.inspect('integration-5173'), lease);
    for (const modification of [{ parent: 1 }, { lease: { ...lease, token: 'stale' } }]) {
      const bad = { ...JSON.parse(env.ZDM_INTEGRATION_OPERATION), ...modification };
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, url, f.root], {
        encoding: 'utf8',
        env: { ...env, ZDM_INTEGRATION_OPERATION: JSON.stringify(bad) },
      });
      assert.notEqual(result.status, 0);
      assert.deepEqual(f.leases.inspect('integration-5173'), lease);
    }
  });
});
test('the actual final handoff refuses a data-copy lease before fetch, Git mutation or runtime writes', async (t) => {
  const f = fixture(t),
    main = 'a'.repeat(40),
    lease = f.leases.acquire('integration-5173', 'data-copy');
  const state = {
    startedAt: new Date().toISOString(),
    events: [
      {
        name: 'ci',
        status: 'success',
        result: { headSha: main, eventName: 'push', branch: 'main', attempt: 1, conclusion: 'success' },
      },
    ],
  };
  await assert.rejects(
    finalHandoff(f.root, { id: 'delivery' }, main, {
      state,
      common: f.common,
      save: () => {},
      execute: () => assert.fail('owned integration must not be mutated'),
    }),
    /Resource is owned/,
  );
  assert.deepEqual(f.leases.inspect('integration-5173'), lease);
  f.leases.release(lease);
});
test('direct backend callers, database readiness, and legacy sync share the same actual resource guard', async (t) => {
  const f = fixture(t);
  execFileSync('git', ['-C', f.root, 'checkout', '-b', 'codex/integration-current'], { stdio: 'pipe' });
  writeFileSync(path.join(f.root, 'base'), 'base');
  execFileSync('git', [
    '-C',
    f.root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=test@example.invalid',
    'add',
    'base',
  ]);
  execFileSync('git', [
    '-C',
    f.root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'base',
  ]);
  const lease = f.leases.acquire('integration-5173', 'data-copy'),
    forbidden = () => assert.fail('busy integration cannot start Docker');
  await assert.rejects(
    ensureIntegrationDatabase(f.root, { prepare: forbidden, execute: forbidden }),
    /Resource is owned/,
  );
  await assert.rejects(ensureBackend(f.root, { ensureDatabase: forbidden }), /Resource is owned/);
  const entry = new URL('./sync-integration.mjs', import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {syncIntegration}=await import(process.argv[1]);syncIntegration('codex/task');`,
      entry,
    ],
    { cwd: f.root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Resource is owned/);
  assert.deepEqual(f.leases.inspect('integration-5173'), lease);
  f.leases.release(lease);
});
