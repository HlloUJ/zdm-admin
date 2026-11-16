import assert from 'node:assert/strict';
import path from 'node:path';
import { npmPackagePath } from './delivery-repairs/task-cleanup-npm-proof.mjs';

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
    state: 'automatic-partial-handoff',
    reason:
      'Only independently audited pristine lock/archive packages; install scripts, links, nested and unknown content remain protected',
  },
  {
    type: 'dependency-cache',
    state: 'protected-preservation',
    reason: 'Dependency caches and install backups remain protected',
  },
  {
    type: 'test-output-and-fixtures',
    state: 'automatic-handoff',
    scope:
      'Only exact creation-proved E2E builds and Git-template fixtures; existing unregistered outputs/failures remain protected',
  },
  {
    type: 'temporary-source-copy',
    state: 'automatic-handoff',
    scope:
      'Only creator-registered exact Git source copies in stable created-sources carrier; no historical temporary-directory scan',
  },
  {
    type: 'expired-duplicate-report',
    state: 'automatic-handoff',
    scope:
      'Only complete extra test-results/playwright-report/coverage copies with immutable preservation proof; necessary raw blobs and first failures retained',
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
  if (
    /^\.task-runtime\/(?:task-artifacts|cleanup-dist(?:-handoff)?|dependency-install-result|dependency-cleanup-audit-result)\.json$/.test(
      file,
    )
  )
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
  reportHandoffs = [],
  createdArtifacts = { registered: false, artifacts: [] },
  createdHandoffs = { registered: false, handedOff: [], protected: [] },
  dependencyArtifacts = { registered: false, artifacts: [], protected: [] },
  dependencyHandoffs = { registered: false, handedOff: [], protected: [] },
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
  for (const handoff of reportHandoffs) {
    assert.ok(['test-results', 'playwright-report', 'coverage'].includes(handoff.relative));
    assert.equal(handoff.state, 'handed-off');
    resources.push({
      type: 'expired-duplicate-report',
      disposition: 'pending-cleanup',
      reason: 'Whole extra copy matches durable preservation; retain necessary stable originals',
      ...handoff,
      spaceReleased: false,
    });
  }
  for (const artifact of createdArtifacts.artifacts) {
    assert.ok(['e2e-test-build-v1', 'generated-fixture-v1', 'git-source-copy-v1'].includes(artifact.kind));
    const handedOff = createdHandoffs.handedOff.find((item) => item.id === artifact.id);
    const protectedRecord = createdHandoffs.protected.find(
      (item) => item.kind === artifact.kind && item.source === artifact.source,
    );
    resources.push({
      type: artifact.kind === 'git-source-copy-v1' ? 'temporary-source-copy' : 'test-output-and-fixtures',
      kind: artifact.kind,
      sourceLocations: [artifact.source],
      disposition: handedOff ? 'pending-cleanup' : 'protected-retention',
      reason: handedOff
        ? 'Creation-proved exact object accepted by the stable queue'
        : (protectedRecord?.reason ?? artifact.reason ?? 'Creator registration retained; no completed handoff'),
      evidence: artifact.registration ?? createdArtifacts.index,
      creationIndex: createdArtifacts.index,
      ...(handedOff ? { manifest: handedOff.manifest, object: handedOff.object ?? handedOff.key } : {}),
      spaceReleased: false,
    });
  }
  for (const artifact of dependencyArtifacts.artifacts) {
    npmPackagePath(artifact.relative);
    assert.equal(artifact.source, path.join(root, artifact.relative), 'Foreign dependency inventory source');
    assert.equal(
      artifact.registration,
      path.join(common, 'task-cleanup/proofs', task, artifact.digest + '.json'),
      'Foreign dependency audit proof',
    );
    assert.match(artifact.digest, /^[a-f0-9]{64}$/);
    const handedOff = dependencyHandoffs.handedOff.find((item) => item.relative === artifact.relative),
      protectedRecord = dependencyHandoffs.protected.find((item) => item.relative === artifact.relative);
    if (handedOff) {
      assert.match(handedOff.object, /^[a-f0-9]{64}$/);
      assert.equal(
        handedOff.manifest,
        path.join(common, 'task-cleanup/staging', task, handedOff.object, 'manifest.json'),
        'Foreign dependency handoff',
      );
    }
    resources.push({
      type: 'private-dependencies',
      kind: 'npm-pristine-package-v1',
      sourceLocations: [artifact.source],
      disposition: handedOff
        ? ['cleaned', 'already-absent'].includes(handedOff.state)
          ? 'cleanup-result-recorded'
          : 'pending-cleanup'
        : 'protected-retention',
      reason: handedOff
        ? 'Independently audited pristine package accepted by the stable queue; deletion still requires formal closure and independent byte proof'
        : (protectedRecord?.reason ?? artifact.reason ?? 'Audit retained; no completed dependency handoff'),
      evidence: artifact.registration,
      auditIndex: dependencyArtifacts.index,
      ...(handedOff ? { manifest: handedOff.manifest, object: handedOff.object, cleanupState: handedOff.state } : {}),
      spaceReleased: false,
    });
  }
  const gaps = CLEANUP_TYPE_COVERAGE.filter((c) => c.state === 'gap').map((c) => ({ type: c.type, reason: c.reason }));
  for (const resource of resources.filter((item) => item.disposition === 'needs-review'))
    gaps.push({
      type: resource.type,
      reason: 'Known preserved resource requires classification; no deletion permission',
    });
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
    createdArtifacts: {
      index: createdArtifacts.index ?? null,
      registered: createdArtifacts.registered,
      resources: createdArtifacts.artifacts.length,
    },
    dependencyArtifacts: {
      index: dependencyArtifacts.index ?? null,
      registered: dependencyArtifacts.registered,
      resources: dependencyArtifacts.artifacts.length,
      summary: dependencyArtifacts.summary ?? null,
      protected: dependencyHandoffs.registered ? dependencyHandoffs.protected : dependencyArtifacts.protected,
    },
    resources,
    typeCoverage: CLEANUP_TYPE_COVERAGE,
    gaps,
    implementationComplete: gaps.length === 0,
  };
}
