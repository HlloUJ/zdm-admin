import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ENGINEERING_EXTRA_INPUTS, SCRIPT_INPUT_MANIFEST, captureReviewedScriptEntries } from '../script-test-plan.mjs';
import { formatEngineeringManifest, verifyParentEngineeringManifests } from './pre-ci-composition.mjs';

const existing = ENGINEERING_EXTRA_INPUTS.slice(0, -2);
const added = ENGINEERING_EXTRA_INPUTS.slice(-2);
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'manifest-history-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (file, data) => {
    const dst = path.join(root, file);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, data);
  };
  const manifest = (inputs) =>
    formatEngineeringManifest(
      captureReviewedScriptEntries(['scripts/fixture.mjs', ...inputs], (file) =>
        readFileSync(path.join(root, file), 'utf8'),
      ),
    );
  const checkPoint = (inputs, description) => {
    write(SCRIPT_INPUT_MANIFEST, manifest(inputs));
    git('add', '-A');
    git('commit', '-qm', description);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Synthetic fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  for (const input of existing) write(input, 'historical input\n');
  write('scripts/fixture.mjs', 'export const value = 1;\n');
  const base = checkPoint(existing, 'historical published input set');
  git('checkout', '-qb', 'task');
  write('scripts/fixture.mjs', 'export const value = 2;\n');
  const task = checkPoint(existing, 'historical task');
  git('checkout', '-q', 'main');
  for (const input of added) write(input, 'published later\n');
  const main = checkPoint(ENGINEERING_EXTRA_INPUTS, 'expand published input set');
  return { root, git, write, checkPoint, base, task, main };
}

test('checks an original task against its exact historical published input set', (t) => {
  const f = fixture(t);
  assert.doesNotThrow(() => verifyParentEngineeringManifests(f.root, f.task, f.main));
  assert.doesNotThrow(() => verifyParentEngineeringManifests(f.root, f.main, f.main));
});

test('rejects deletion and manifest removal of an input already present in the historical published tree', (t) => {
  const f = fixture(t);
  f.git('checkout', '-q', 'task');
  unlinkSync(path.join(f.root, existing[0]));
  const changed = f.checkPoint(existing.slice(1), 'attempt to omit existing input');
  assert.throws(() => verifyParentEngineeringManifests(f.root, changed, f.main), /only inputs added after/);
});

test('rejects old task scripts that no longer match their recorded manifest', (t) => {
  const f = fixture(t);
  f.git('checkout', '-q', 'task');
  f.write('scripts/fixture.mjs', 'export const value = 3;\n');
  f.git('add', 'scripts/fixture.mjs');
  f.git('commit', '-qm', 'leave stale historical manifest');
  assert.throws(
    () => verifyParentEngineeringManifests(f.root, f.git('rev-parse', 'HEAD'), f.main),
    /Parent engineering manifest is not current/,
  );
});

test('current main still requires its entire current input list', (t) => {
  const f = fixture(t);
  unlinkSync(path.join(f.root, added[0]));
  const changed = f.checkPoint(
    ENGINEERING_EXTRA_INPUTS.filter((name) => name !== added[0]),
    'attempt to omit new main input',
  );
  assert.throws(() => verifyParentEngineeringManifests(f.root, f.task, changed), /Missing engineering input/);
});

test('rejects a side-parent Git history as an unpublished source for historical inputs', (t) => {
  const f = fixture(t);
  f.git('checkout', '-qb', 'unpublished', f.base);
  f.write('scripts/fixture.mjs', 'export const value = 4;\n');
  const side = f.checkPoint(existing, 'unpublished historical input set');
  f.git('checkout', '-q', 'main');
  f.git('merge', '--no-ff', '--no-edit', side);
  const main = f.git('rev-parse', 'HEAD');
  assert.throws(() => verifyParentEngineeringManifests(f.root, side, main), /not published on main/);
});

test('rejects invalid original published manifest bytes even when the old task declarations agree', (t) => {
  const f = fixture(t);
  f.git('checkout', '-qb', 'bad-history', f.base);
  f.write('scripts/fixture.mjs', 'export const value = 10;\n');
  f.git('add', 'scripts/fixture.mjs');
  f.git('commit', '-qm', 'leave stale published historical manifest');
  const historical = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-qb', 'task-from-bad-history', historical);
  const task = f.checkPoint(existing, 'task with current manifest');
  f.git('checkout', '-q', 'bad-history');
  for (const input of added) f.write(input, 'published later\n');
  const main = f.checkPoint(ENGINEERING_EXTRA_INPUTS, 'current main has complete manifest');
  assert.throws(
    () => verifyParentEngineeringManifests(f.root, task, main),
    /Historical published input manifest is not current/,
  );
});
