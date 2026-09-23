import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const SOURCE_GUARD_TESTS = ['scripts/feedback-foundation.test.mjs'];
const MANIFEST = 'scripts/test-domain-manifest.json';
const EXTRA_INPUTS = [
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'docker-compose.yml',
  'docker-compose.task.yml',
  '.codex/zdm-project-workflow.yaml',
];
const hash = (value) => createHash('sha256').update(value).digest('hex');
function filesBelow(root, directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(root, file) : [file];
  });
}
export function scriptTestFiles(root, domain = 'all') {
  const files = filesBelow(root, 'scripts')
    .filter((file) => file.endsWith('.test.mjs'))
    .sort();
  return files.filter((file) => domain !== 'engineering' || !SOURCE_GUARD_TESTS.includes(file));
}
function importsFor(file, source) {
  const imports = [
    ...source.matchAll(/^\s*(?:import\s+(?:[\s\S]*?\sfrom\s*)?|export\s+[^;]*?\sfrom\s*)['"]([^'"]+)['"]/gm),
  ]
    .map((match) => match[1])
    .filter((value) => value.startsWith('.'))
    .map((value) => path.posix.normalize(path.posix.join(path.posix.dirname(file), value)));
  // Literal CLI/URL references are dependencies too. False positives only broaden the suite.
  for (const match of source.matchAll(/['"]((?:\.\.?\/|scripts\/)[^'"\n]+\.(?:mjs|js))['"]/g)) {
    imports.push(
      match[1].startsWith('scripts/')
        ? match[1]
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])),
    );
  }
  return [...new Set(imports)].sort();
}

// Updating this snapshot is a review action: inspect actual filesystem readers and imports first.
// A changed/new/unreviewed engineering input forces full engineering CI until that review occurs.
export function captureReviewedScriptInputs(root) {
  const files = [...filesBelow(root, 'scripts').filter((file) => file !== MANIFEST), ...EXTRA_INPUTS].sort();
  return {
    version: 1,
    sourceGuards: SOURCE_GUARD_TESTS,
    files: Object.fromEntries(
      files.map((file) => {
        const source = readFileSync(path.join(root, file), 'utf8');
        return [
          file,
          {
            digest: hash(source),
            imports: importsFor(file, source),
            dynamicImports: (source.match(/\b(?:import\s*\(|require\s*\()/g) ?? []).length,
          },
        ];
      }),
    ),
  };
}
export function engineeringDomainProof(root) {
  try {
    const expected = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
    const actual = captureReviewedScriptInputs(root);
    const proven = JSON.stringify(expected) === JSON.stringify(actual);
    return {
      proven,
      fingerprint: hash(JSON.stringify(actual)),
      reason: proven
        ? 'Reviewed engineering inputs are unchanged.'
        : 'Engineering inputs or readers need renewed scope review.',
    };
  } catch {
    return { proven: false, fingerprint: null, reason: 'Engineering input proof is unavailable.' };
  }
}

export function createScriptTestPlan(files, root) {
  const changed = files.filter((file) => file.startsWith('scripts/'));
  if (!changed.length) return { mode: 'none', tests: [], reason: 'No engineering source change.' };
  const full = (reason) => ({ mode: 'full', tests: [], reason });
  if (!root) return full('No repository input proof; run all script tests.');
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST), 'utf8'));
    const current = captureReviewedScriptInputs(root);
    if (
      manifest.version !== 1 ||
      JSON.stringify(Object.keys(manifest.files)) !== JSON.stringify(Object.keys(current.files))
    )
      return full('New, deleted or renamed engineering input.');
    if (changed.some((file) => !file.endsWith('.mjs') || !manifest.files[file]))
      return full('Unmapped engineering input.');
    for (const [file, value] of Object.entries(current.files)) {
      const old = manifest.files[file];
      if (JSON.stringify(value.imports) !== JSON.stringify(old.imports) || value.dynamicImports !== old.dynamicImports)
        return full(`Import or CLI dependency changed: ${file}`);
    }
    for (const [file, value] of Object.entries(current.files)) {
      const old = manifest.files[file];
      if (value.digest === old.digest) continue;
      if (!file.startsWith('scripts/')) return full(`Shared engineering configuration changed: ${file}`);
      const source = readFileSync(path.join(root, file), 'utf8');
      if (
        value.dynamicImports ||
        /(?:node:fs|readFile|readdir|createReadStream|execFile|spawnSync|spawn\s*\()/.test(source)
      )
        return full(`Filesystem, process or dynamic dependency reader changed: ${file}`);
    }
    const affected = new Set(changed);
    let progress = true;
    while (progress) {
      progress = false;
      for (const [file, value] of Object.entries(current.files)) {
        if (!affected.has(file) && value.imports.some((dependency) => affected.has(dependency))) {
          affected.add(file);
          progress = true;
        }
      }
    }
    const tests = scriptTestFiles(root).filter((file) => affected.has(file));
    if (!tests.length) return full('No proven test consumer for the changed scripts.');
    return {
      mode: 'targeted',
      tests,
      reason: 'Reviewed direct and transitive script consumers; changed imports fall back to all.',
    };
  } catch {
    return full('Cannot prove script dependency closure.');
  }
}
