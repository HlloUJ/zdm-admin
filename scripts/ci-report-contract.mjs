import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Collection, replay validation and upload selection share these relative paths.
export const BACKEND_REPORTS = Object.freeze({
  surefire: 'surefire-reports',
  jacoco: 'site/jacoco',
  execution: 'jacoco.exec',
  checkstyle: 'checkstyle-result.xml',
  spotbugs: 'spotbugsXml.xml',
});
export const CI_EVIDENCE_ROOT = 'coverage/ci-evidence';
export const backendCollectedPath = (name) => {
  assert.ok(Object.hasOwn(BACKEND_REPORTS, name), 'Unknown report kind');
  return `reports/${name}`;
};
export function backendUploads(metadata, evidenceRoot = CI_EVIDENCE_ROOT) {
  assert.ok(
    metadata.execution === undefined || ['executed', 'reused'].includes(metadata.execution),
    'Unknown backend execution',
  );
  return {
    full: evidenceRoot,
    standalone:
      metadata.execution === 'reused'
        ? `${evidenceRoot}/${backendCollectedPath('surefire')}`
        : `backend/target/${BACKEND_REPORTS.surefire}`,
  };
}
export async function emitBackendUploads(root, env = process.env) {
  assert.ok(env.GITHUB_OUTPUT, 'Missing output destination');
  // Keep the full failure packet available even if subsequent report validation fails.
  const canonical = (value) =>
    existsSync(value) ? realpathSync(value) : path.join(canonical(path.dirname(value)), path.basename(value));
  const actualRoot = realpathSync(root);
  const relative = path
    .relative(actualRoot, canonical(path.resolve(root, env.CI_EVIDENCE_DIR ?? CI_EVIDENCE_ROOT)))
    .split(path.sep)
    .join('/');
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Evidence must stay inside the workspace',
  );
  appendFileSync(env.GITHUB_OUTPUT, `backend_full_path=${relative}\n`);
  const directory = path.join(actualRoot, relative),
    file = path.join(directory, 'metadata.json');
  const metadata = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const sources = backendUploads(metadata, relative);
  if (metadata.execution === 'reused') {
    const { validateReusedMetadata } = await import('./ci-equivalence.mjs');
    const { validateBackendEvidence } = await import('./ci-backend-equivalence.mjs');
    validateReusedMetadata(metadata);
    assert.ok(metadata.reusedFrom, 'Missing replay provenance');
    validateBackendEvidence(directory, metadata.backendEvidence, root);
  }
  appendFileSync(env.GITHUB_OUTPUT, `backend_reports_path=${sources.standalone}\n`);
  return sources;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  emitBackendUploads(process.cwd()).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
