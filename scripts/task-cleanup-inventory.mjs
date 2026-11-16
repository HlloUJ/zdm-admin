import assert from 'node:assert/strict';
import path from 'node:path';

const knownDirectories = [
  '.task-runtime/cache',
  '.task-verification',
  'test-results',
  'playwright-report',
  'coverage',
  'dist',
  'backend/target',
];
export const CLEANUP_TYPE_COVERAGE = Object.freeze([
  {
    type: 'application-build',
    state: 'automatic-handoff',
    scope: 'Only unchanged creation-registered Vite dist; other output is protected',
  },
  {
    type: 'private-dependencies',
    state: 'protected-preservation',
    reason:
      'Links, unknown package-local content and missing rebuild proof remain protected; no expanded deletion permission',
  },
  {
    type: 'dependency-cache',
    state: 'protected-preservation',
    reason: 'Dependency caches and install backups remain protected',
  },
  {
    type: 'test-output-and-fixtures',
    state: 'gap',
    reason: 'No creation-time reclaim proof/consumer type; preserve original output and failures',
  },
  {
    type: 'temporary-source-copy',
    state: 'gap',
    reason: 'External source capsules need creation registration; do not scan unknown temporary directories',
  },
  {
    type: 'expired-duplicate-report',
    state: 'gap',
    reason:
      'Content-addressed preservation avoids identical blob copies; expiry/reference-safe retirement is not implemented',
  },
  {
    type: 'necessary-evidence',
    state: 'protected-preservation',
    reason: 'Keep original reports, first failure, source and runtime evidence',
  },
  {
    type: 'unclassified-owned-output',
    state: 'needs-review',
    reason: 'Preservation ownership is not proof of rebuildability',
  },
]);
function groupFor(file) {
  if (file === 'node_modules' || file.startsWith('node_modules/')) return 'private-dependencies';
  if (file === 'dist' || file.startsWith('dist/')) return 'application-build';
  if (/^\.task-runtime\/(?:npm-cache|cache|dependency-backups)(?:\/|$)/.test(file)) return 'dependency-cache';
  if (/^\.task-runtime\/(?:source-copy|source-capsule|diagnostic-source)(?:\/|$)/.test(file))
    return 'temporary-source-copy';
  if (
    /^(?:test-results|playwright-report|coverage|backend\/target)(?:\/|$)/.test(file) ||
    /^\.task-runtime\/e2e-app(?:\/|$)/.test(file)
  )
    return 'test-output-and-fixtures';
  if (/^\.task-runtime\/(?:task-artifacts|cleanup-dist(?:-handoff)?|dependency-install-result)\.json$/.test(file))
    return 'necessary-evidence';
  if (/^\.task-verification(?:\/|$)/.test(file)) return 'necessary-evidence';
  return 'unclassified-owned-output';
}
export function buildCloseoutCleanupInventory({
  root,
  common,
  task,
  proof,
  preserved,
  manifestDigest,
  entries,
  artifacts = null,
  distHandoff,
  externalDependencyTarget = null,
}) {
  assert.match(task, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(proof.worktree, root);
  for (const field of ['head', 'accepted', 'main'])
    assert.match(proof[field] ?? '', /^[a-f0-9]{40}$/, 'Missing exact delivery proof');
  assert.equal(
    preserved.manifest.startsWith(path.join(common, 'task-assets', task) + path.sep),
    true,
    'Foreign preservation carrier',
  );
  assert.match(manifestDigest, /^[a-f0-9]{64}$/);
  if (artifacts) {
    assert.equal(artifacts.version, 1, 'Unknown created-resource registration');
    assert.equal(artifacts.task, task);
    assert.equal(artifacts.worktree, root);
    assert.equal(artifacts.ready, true);
  }
  const groups = new Map();
  for (const entry of entries) {
    assert.ok(
      typeof entry.file === 'string' && !path.isAbsolute(entry.file) && !entry.file.split(/[\\/]/).includes('..'),
      'Invalid preserved resource path',
    );
    const type = groupFor(entry.file);
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(entry);
  }
  const resources = [];
  for (const [type, items] of groups) {
    const coverage = CLEANUP_TYPE_COVERAGE.find((c) => c.type === type);
    const privateDependencies = type === 'private-dependencies';
    resources.push({
      type,
      disposition:
        type === 'unclassified-owned-output' || type === 'temporary-source-copy'
          ? 'needs-review'
          : 'protected-retention',
      reason: coverage.reason ?? 'No valid rebuild registration for this preserved build output',
      sourceLocations: privateDependencies
        ? ['node_modules']
        : [
            ...new Set(
              items.map((e) =>
                e.file
                  .split('/')
                  .slice(0, e.file.startsWith('.task-runtime/') ? 2 : 1)
                  .join('/'),
              ),
            ),
          ].sort(),
      preserved: {
        manifest: preserved.manifest,
        manifestDigest,
        selector: { type, files: items.length },
        ...(privateDependencies
          ? {
              location: items.some((i) => i.kind === 'external-dependency-retained')
                ? {
                    kind: 'external-link-target-retained',
                    path: externalDependencyTarget,
                    ownership: 'external-never-delete',
                  }
                : {
                    kind: 'retained-private-directory',
                    path: path.join(common, 'task-assets', task, 'private-dependencies'),
                  },
            }
          : { location: { kind: 'content-addressed-blobs', path: path.join(common, 'task-assets', task, 'blobs') } }),
      },
    });
  }
  const registered = [];
  for (const [relative, target] of Object.entries(artifacts?.directories ?? {})) {
    assert.ok(knownDirectories.includes(relative), 'Unknown created-resource registration; preserve and inspect');
    assert.equal(target, path.join(root, relative), 'Created resource points outside the exact task');
    registered.push({
      relative,
      sourceLocation: target,
      classification:
        relative === 'dist' && distHandoff?.state === 'handed-off'
          ? 'handed-off'
          : groups.has(groupFor(relative + '/placeholder'))
            ? 'covered-by-preservation-manifest'
            : 'registered-with-no-preserved-files',
      evidence: preserved.manifest,
    });
  }
  if (distHandoff?.state === 'handed-off')
    resources.push({
      type: 'application-build',
      disposition: 'pending-cleanup',
      reason: 'Creation proof, unchanged source/object, no references and stable queue acceptance',
      manifest: distHandoff.manifest,
      object: distHandoff.object,
      spaceReleased: false,
    });
  else if (artifacts?.directories?.dist)
    resources.push({
      type: 'application-build',
      disposition: 'protected-retention',
      reason: distHandoff?.reason ?? 'No valid creation registration; original preservation applies',
      evidence: preserved.manifest,
    });
  const gaps = CLEANUP_TYPE_COVERAGE.filter((c) => c.state === 'gap').map((c) => ({ type: c.type, reason: c.reason }));
  if (!artifacts)
    gaps.push({
      type: 'creation-registration',
      reason: 'No task-artifacts creation receipt; only existing exact preservation entries were classified',
    });
  return {
    version: 1,
    task,
    proof,
    state: 'inventory-handed-off',
    spaceReleased: false,
    sourceRegistration: artifacts ? 'registered' : 'missing',
    preservation: { manifest: preserved.manifest, manifestDigest },
    registered,
    resources,
    typeCoverage: CLEANUP_TYPE_COVERAGE,
    gaps,
    implementationComplete: gaps.length === 0,
  };
}
