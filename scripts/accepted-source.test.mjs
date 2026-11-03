import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acceptedGit,
  freezeAcceptedSource,
  readAcceptance,
  assertAcceptedSource,
  publishAcceptance,
  verifyRemoteAcceptance,
  acceptedRef,
} from './accepted-source.mjs';
import { runAcceptedSourceCI } from './accepted-source-ci.mjs';
import { checkAcceptedIndex } from './accepted-source-hook.mjs';
import { isTechnicalPath } from './accepted-source-policy.mjs';
import { assessAcceptedProtection } from './accepted-source-readiness.mjs';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'accepted-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => acceptedGit(root, args);
  git('init', '-b', 'codex/example');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'scripts'));
  writeFileSync(path.join(root, '.gitignore'), '.task-verification/\n.env\n');
  writeFileSync(path.join(root, 'src/product.js'), 'export const price = 12;\n');
  writeFileSync(path.join(root, 'src/obsolete.js'), 'old business');
  writeFileSync(path.join(root, 'scripts/check.mjs'), '// technical\n');
  git('add', '.');
  git('commit', '-m', 'initial');
  const batch = { id: 'example', branch: 'codex/example', worktree: root };
  const commit = () => {
    git('add', '--all');
    git('commit', '-m', 'candidate');
    return git('rev-parse', 'HEAD');
  };
  return { root, git, batch, commit };
}
test('capture includes reviewed uncommitted additions and deletions without changing HEAD, index, or worktree', (t) => {
  const f = fixture(t),
    before = f.git('rev-parse', 'HEAD'),
    index = f.git('write-tree');
  writeFileSync(path.join(f.root, 'src/product.js'), 'export const price = 25;\n');
  rmSync(path.join(f.root, 'src/obsolete.js'));
  writeFileSync(path.join(f.root, 'src/new.js'), 'unfinished but reviewed');
  writeFileSync(path.join(f.root, '.env'), 'PRIVATE-not-captured');
  const record = freezeAcceptedSource(f.root, f.batch);
  assert.equal(f.git('rev-parse', 'HEAD'), before);
  assert.equal(f.git('write-tree'), index);
  assert.equal(readFileSync(path.join(f.root, 'src/product.js'), 'utf8'), 'export const price = 25;\n');
  assert.ok(!f.git('ls-tree', '-r', '--name-only', record.tree).split('\n').includes('.env'));
  assert.deepEqual(freezeAcceptedSource(f.root, f.batch), record);
  const candidate = f.commit();
  assertAcceptedSource(f.root, f.batch.id, candidate);
  verifyRemoteAcceptance(f.root, { candidate, accepted: record.commit, branch: f.batch.branch });
});
for (const attack of ['edit', 'add', 'delete', 'rename', 'mode', 'production-config', 'control-policy']) {
  test('trusted verifier blocks business/control-plane attack: ' + attack, (t) => {
    const f = fixture(t),
      record = freezeAcceptedSource(f.root, f.batch);
    if (attack === 'edit') writeFileSync(path.join(f.root, 'src/product.js'), 'changed business');
    if (attack === 'add') writeFileSync(path.join(f.root, 'src/new.js'), 'unreviewed');
    if (attack === 'delete') rmSync(path.join(f.root, 'src/product.js'));
    if (attack === 'rename') {
      writeFileSync(path.join(f.root, 'src/renamed.js'), 'export const price = 12;\n');
      rmSync(path.join(f.root, 'src/product.js'));
    }
    if (attack === 'mode') {
      f.git('update-index', '--chmod=+x', 'src/product.js');
      f.git('commit', '-m', 'mode');
    }
    if (attack === 'production-config')
      writeFileSync(path.join(f.root, 'package.json'), '{"dependencies":{"changed":"1"}}');
    if (attack === 'control-policy')
      writeFileSync(path.join(f.root, 'scripts/accepted-source-policy.mjs'), 'export const isTechnicalPath=()=>true;');
    const candidate = attack === 'mode' ? f.git('rev-parse', 'HEAD') : f.commit();
    assert.throws(() => assertAcceptedSource(f.root, f.batch.id, candidate), /differs from accepted/);
    assert.throws(
      () => verifyRemoteAcceptance(f.root, { candidate, accepted: record.commit, branch: f.batch.branch }),
      /changed accepted/,
    );
    assert.deepEqual(
      freezeAcceptedSource(f.root, f.batch),
      record,
      'Cannot replace baseline with the failed candidate',
    );
  });
}
test('technical repair is allowed while unknown paths and production dependencies stay protected', (t) => {
  const f = fixture(t),
    record = freezeAcceptedSource(f.root, f.batch);
  writeFileSync(path.join(f.root, 'scripts/check.mjs'), '// repaired CI\n');
  const candidate = f.commit();
  assertAcceptedSource(f.root, f.batch.id, candidate);
  verifyRemoteAcceptance(f.root, { candidate, accepted: record.commit, branch: f.batch.branch });
  assert.equal(isTechnicalPath('package-lock.json'), false);
  assert.equal(isTechnicalPath('vite.config.js'), false);
  assert.equal(isTechnicalPath('unknown/new-business.bin'), false);
  assert.equal(isTechnicalPath('docs/ui/standard.md'), false);
  assert.equal(isTechnicalPath('tests/e2e/obsolete.spec.ts'), true);
});
test('wrong source, wrong branch binding, record edits and acceptance-ref replacement fail closed', (t) => {
  const f = fixture(t),
    record = freezeAcceptedSource(f.root, f.batch);
  assert.throws(() => freezeAcceptedSource(path.dirname(f.root), f.batch), /registered developer/);
  assert.throws(() =>
    verifyRemoteAcceptance(f.root, {
      candidate: f.git('rev-parse', 'HEAD'),
      accepted: record.commit,
      branch: 'codex/other',
    }),
  );
  f.git('update-ref', 'refs/zdm/accepted/example', f.git('rev-parse', 'HEAD'));
  assert.throws(() => readAcceptance(f.root, 'example'), /ref changed/);
});
test('remote acceptance publication is idempotent and never overwrites an existing baseline', (t) => {
  const f = fixture(t),
    remote = path.join(f.root, '.task-verification/origin.git');
  mkdirSync(path.dirname(remote), { recursive: true });
  f.git('init', '--bare', remote);
  f.git('remote', 'add', 'origin', remote);
  const record = freezeAcceptedSource(f.root, f.batch);
  const first = publishAcceptance(f.root, 'example');
  assert.equal(first.commit, record.commit);
  assert.deepEqual(publishAcceptance(f.root, 'example'), first);
  const origin = (...args) => acceptedGit(remote, args);
  origin('update-ref', acceptedRef('example'), f.git('rev-parse', 'HEAD'));
  assert.throws(() => publishAcceptance(f.root, 'example'), /immutable/);
  assert.ok(existsSync(path.join(f.root, 'src/product.js')));
});
test('readiness never describes an administrator or unbound Actions check as independent enforcement', () => {
  const base = {
    permission: 'WRITE',
    verifierPublished: true,
    originBound: true,
    protection: {
      enforce_admins: { enabled: true },
      required_status_checks: { strict: true, contexts: ['Accepted business snapshot'] },
    },
    tagRulesets: [
      {
        target: 'tag',
        enforcement: 'active',
        bypass_actors: [],
        conditions: { ref_name: { include: ['refs/tags/zdm-accepted/**'] } },
        rules: [{ type: 'update' }, { type: 'deletion' }],
      },
    ],
  };
  assert.equal(assessAcceptedProtection(base).configurationReady, true);
  assert.equal(assessAcceptedProtection(base).independentEnforcement, false);
  for (const change of [
    { permission: 'ADMIN' },
    { originBound: false },
    { tagRulesets: [] },
    { verifierPublished: false },
  ])
    assert.equal(assessAcceptedProtection({ ...base, ...change }).configurationReady, false);
});

test('new unclassified scripts are protected; pre-reviewed test additions retain their existing exemption', (t) => {
  const f = fixture(t);
  freezeAcceptedSource(f.root, f.batch);
  mkdirSync(path.join(f.root, 'tests'));
  writeFileSync(path.join(f.root, 'tests/new.test.mjs'), '// regression');
  assertAcceptedSource(f.root, 'example', f.commit());
  writeFileSync(path.join(f.root, 'scripts/new-business.mjs'), '// unclassified');
  assert.throws(() => assertAcceptedSource(f.root, 'example', f.commit()), /differs from accepted/);
});

test('pre-merge tree comparison detects remote-only business changes before changing main', (t) => {
  const f = fixture(t),
    record = freezeAcceptedSource(f.root, f.batch),
    candidate = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-b', 'main');
  writeFileSync(path.join(f.root, 'src/other-module.js'), 'remote business not in accepted snapshot');
  const main = f.commit();
  const mergedTree = f.git('merge-tree', '--write-tree', main, candidate).split('\n')[0];
  assert.throws(() => assertAcceptedSource(f.root, 'example', mergedTree), /differs from accepted/);
  assert.equal(f.git('rev-parse', 'main'), main);
  assert.equal(readAcceptance(f.root, 'example').commit, record.commit);
});
test('Git line-ending conversions cannot silently change the accepted local business bytes', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, '.gitattributes'), 'src/product.js text eol=lf\n');
  writeFileSync(path.join(f.root, 'src/product.js'), 'export const price = 12;\r\n');
  assert.throws(() => freezeAcceptedSource(f.root, f.batch), /conversion changed/);
  assert.equal(readAcceptance(f.root, 'example'), null);
  assert.equal(readFileSync(path.join(f.root, 'src/product.js'), 'utf8'), 'export const price = 12;\r\n');
});

test('accepted unfinished development state is retained without promoting modules', (t) => {
  const f = fixture(t);
  f.batch.modules = [{ id: 'unfinished', status: 'developing', dependsOn: ['prior'] }];
  const accepted = freezeAcceptedSource(f.root, f.batch);
  assert.deepEqual(accepted.developmentState, f.batch.modules);
  f.batch.modules[0].status = 'ready';
  assert.equal(readAcceptance(f.root, f.batch.id).developmentState[0].status, 'developing');
  assert.ok(accepted.protectedPaths.includes('src/product.js'));
});

test('frozen commit index blocks staged business edits without rewriting the index or worktree', (t) => {
  const f = fixture(t);
  freezeAcceptedSource(f.root, f.batch);
  assert.equal(checkAcceptedIndex(f.root, f.batch), true);
  writeFileSync(path.join(f.root, 'src/product.js'), 'later user business');
  f.git('add', '.');
  const before = f.git('write-tree');
  assert.throws(() => checkAcceptedIndex(f.root, f.batch), /differs from accepted/);
  assert.equal(f.git('write-tree'), before);
  assert.equal(readFileSync(path.join(f.root, 'src/product.js'), 'utf8'), 'later user business');
});

for (const scenario of ['success', 'business-change', 'missing-tag']) {
  test('trusted CI fetches Git objects only and reports exact candidate: ' + scenario, async (t) => {
    const f = fixture(t);
    const remote = path.join(f.root, '.task-verification/origin.git');
    mkdirSync(path.dirname(remote));
    f.git('init', '--bare', remote);
    f.git('remote', 'add', 'origin', remote);
    freezeAcceptedSource(f.root, f.batch);
    writeFileSync(path.join(f.root, 'scripts/check.mjs'), "throw Error('Candidate code must never run');\n");
    if (scenario === 'business-change') writeFileSync(path.join(f.root, 'src/product.js'), 'unreviewed');
    const candidate = f.commit();
    f.git('push', 'origin', f.batch.branch);
    if (scenario !== 'missing-tag') publishAcceptance(f.root, f.batch.id);
    const trusted = path.join(f.root, '.task-verification/trusted');
    mkdirSync(trusted);
    acceptedGit(trusted, ['init']);
    acceptedGit(trusted, ['remote', 'add', 'origin', remote]);
    const calls = [];
    const options = {
      repository: 'owner/repo',
      token: 'test-only',
      request: async (url, init) => {
        calls.push({ url, method: init.method, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ id: 123 }) };
      },
    };
    const event = {
      pull_request: {
        base: { ref: 'main' },
        head: { ref: f.batch.branch, sha: candidate, repo: { full_name: 'owner/repo' } },
      },
    };
    const run = runAcceptedSourceCI(trusted, event, options);
    if (scenario === 'success') assert.equal((await run).candidate, candidate);
    else await assert.rejects(run);
    assert.equal(calls[0].body.head_sha, candidate);
    assert.equal(calls[1].body.conclusion, scenario === 'success' ? 'success' : 'failure');
    assert.equal(calls[1].url.endsWith('/check-runs/123'), true);
    assert.equal(existsSync(path.join(trusted, 'scripts/check.mjs')), false);
    assert.equal(existsSync(path.join(trusted, 'src/product.js')), false);
    const before = calls.length;
    event.pull_request.head.repo.full_name = 'attacker/fork';
    await assert.rejects(runAcceptedSourceCI(trusted, event, options), /Forks/);
    assert.equal(calls.length, before);
  });
}

test('legacy batch ID may differ from its exact bound task branch', (t) => {
  const f = fixture(t);
  f.batch.id = 'legacy-id';
  const accepted = freezeAcceptedSource(f.root, f.batch);
  const candidate = f.git('rev-parse', 'HEAD');
  assert.equal(
    verifyRemoteAcceptance(f.root, { candidate, accepted: accepted.commit, branch: f.batch.branch }).batch,
    'legacy-id',
  );
  assert.throws(() => verifyRemoteAcceptance(f.root, { candidate, accepted: accepted.commit, branch: 'codex/other' }));
});
