// Narrow only audited post-validation tools. Unknown readers and topology changes stay full.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { engineeringDomainProof } from './script-test-plan.mjs';
export const REVIEWED_DELIVERY_INPUTS = [
  'scripts/wait-quality.mjs',
  'scripts/completion-session.test.mjs',
  'scripts/task-preview-service.mjs',
  'scripts/task-preview-service.test.mjs',
  'scripts/completion-preview.mjs',
  'scripts/completion-preview.test.mjs',
  'scripts/completion-cli.mjs',
  'scripts/completion-cli.test.mjs',
  'scripts/completion-handoff.mjs',
  'scripts/completion-flow.mjs',
].sort();
const hash = (source) => createHash('sha256').update(source).digest('hex');
const topology = (entry) => ({ imports: entry.imports, dynamicImports: entry.dynamicImports });
export function engineeringConsumers(manifest, inputs) {
  const consumers = new Set(inputs);
  let progress = true;
  while (progress) {
    progress = false;
    for (const [file, entry] of Object.entries(manifest.files))
      if (
        file !== 'scripts/engineering-impact.json' &&
        !consumers.has(file) &&
        entry.imports.some((input) => consumers.has(input))
      ) {
        consumers.add(file);
        progress = true;
      }
  }
  return [...consumers].sort();
}
export function engineeringExternalReaders(root, consumers) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const names = consumers.map((file) => path.posix.basename(file));
  const readers = {};
  for (const file of [...new Set(files)].sort()) {
    if (
      file.startsWith('scripts/') ||
      !/\.(?:[cm]?[jt]sx?|vue|java|json|ya?ml|html|xml|sh|py|rb|go|rs|toml|properties|ps1)$/.test(file)
    )
      continue;
    const source = readFileSync(path.join(root, file), 'utf8');
    if (
      /\.(?:[cm]?[jt]sx?|vue)$/.test(file) &&
      /\bimport\s*\(\s*[^'"\s]|\bimport\.meta\.glob|(?<!\.)\brequire\s*\(\s*[^'"\s]/.test(source)
    )
      throw Error('Unproven dynamic external consumer: ' + file);
    if (names.some((name) => source.includes(name))) readers[file] = hash(source);
  }
  return readers;
}
export function reflectiveEngineeringReaders(root, manifest, inputs) {
  return Object.fromEntries(
    Object.keys(manifest.files)
      .sort()
      .filter((file) => file.startsWith('scripts/') && file.endsWith('.mjs') && !inputs.includes(file))
      .filter((file) => {
        const source = readFileSync(path.join(root, file), 'utf8');
        return (
          manifest.files[file].dynamicImports > 0 || /node:fs|readFile|readdir|execFile|spawn|node:vm/.test(source)
        );
      })
      .map((file) => [file, hash(readFileSync(path.join(root, file)))]),
  );
}
export function engineeringOnlyProof(root, files) {
  const full = (reason) => ({ proven: false, reason });
  try {
    if (!root || !files.length) return full('No explicit engineering scope');
    const registry = JSON.parse(readFileSync(path.join(root, 'scripts/engineering-impact.json')));
    if (registry.version !== 1) return full('Unknown engineering scope contract');
    const inputs = Object.keys(registry.inputs).sort();
    if (JSON.stringify(inputs) !== JSON.stringify(REVIEWED_DELIVERY_INPUTS))
      return full('Unreviewed engineering domain expansion');
    if (!inputs.length || !files.some((file) => inputs.includes(file))) return full('No audited engineering input');
    if (
      files.some(
        (file) => !inputs.includes(file) && file !== 'scripts/test-domain-manifest.json' && !file.endsWith('.md'),
      )
    )
      return full('Shared or unknown input still requires complete gates');
    if (!engineeringDomainProof(root).proven) return full('Unreviewed engineering inputs');
    const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/test-domain-manifest.json')));
    for (const [file, expected] of Object.entries(registry.inputs)) {
      const entry = manifest.files[file];
      if (!entry || JSON.stringify(topology(entry)) !== JSON.stringify(expected))
        return full('Audited input dependency changed: ' + file);
    }
    if (
      JSON.stringify(reflectiveEngineeringReaders(root, manifest, inputs)) !==
      JSON.stringify(registry.reflectiveReaders)
    )
      return full('Unproven reflective engineering reader added, changed or omitted');
    const consumers = engineeringConsumers(manifest, inputs);
    if (JSON.stringify(consumers) !== JSON.stringify(Object.keys(registry.consumers).sort()))
      return full('Associated engineering consumer omitted or added');
    for (const file of consumers)
      if (JSON.stringify(topology(manifest.files[file])) !== JSON.stringify(registry.consumers[file]))
        return full('Associated consumer topology changed: ' + file);
    if (JSON.stringify(engineeringExternalReaders(root, consumers)) !== JSON.stringify(registry.externalReaders))
      return full('External execution consumer changed or omitted');
    return {
      proven: true,
      files: inputs,
      consumers,
      reason:
        'Reviewed engineering-only execution closure; retain complete engineering tests and required gate aggregation',
    };
  } catch (error) {
    return full('Cannot prove engineering scope: ' + error.message);
  }
}
