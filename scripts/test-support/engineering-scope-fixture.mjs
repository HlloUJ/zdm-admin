import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENGINEERING_EXTRA_INPUTS, captureReviewedScriptInputs } from '../script-test-plan.mjs';
import {
  REVIEWED_DELIVERY_INPUTS,
  engineeringConsumers,
  engineeringExternalReaders,
  reflectiveEngineeringReaders,
} from '../engineering-impact.mjs';
export function engineeringScopeFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'engineering-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  };
  for (const file of ENGINEERING_EXTRA_INPUTS) write(file, '{}');
  for (const file of REVIEWED_DELIVERY_INPUTS) write(file, 'export const value = 1;');
  write('scripts/consumer.mjs', "import './wait-quality.mjs';");
  write('package.json', JSON.stringify({ scripts: { check: 'node scripts/wait-quality.mjs' } }));
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.name', 'Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '.'],
    ['commit', '-m', 'fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const seal = () => write('scripts/test-domain-manifest.json', JSON.stringify(captureReviewedScriptInputs(root)));
  const manifest = captureReviewedScriptInputs(root),
    consumers = engineeringConsumers(manifest, REVIEWED_DELIVERY_INPUTS);
  const topology = (file) => ({
    imports: manifest.files[file].imports,
    dynamicImports: manifest.files[file].dynamicImports,
  });
  const registry = {
    version: 1,
    inputs: Object.fromEntries(REVIEWED_DELIVERY_INPUTS.map((f) => [f, topology(f)])),
    consumers: Object.fromEntries(consumers.map((f) => [f, topology(f)])),
    externalReaders: engineeringExternalReaders(root, consumers),
    reflectiveReaders: reflectiveEngineeringReaders(root, manifest, REVIEWED_DELIVERY_INPUTS),
  };
  const saveRegistry = () => write('scripts/engineering-impact.json', JSON.stringify(registry));
  saveRegistry();
  seal();
  return { root, write, seal, registry, saveRegistry };
}
