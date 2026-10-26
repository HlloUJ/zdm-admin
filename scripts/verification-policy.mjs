import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function needsContractPreflight(files) {
  return files.some((file) =>
    /^(?:scripts\/|ci\/|\.github\/workflows\/|(?:playwright|vite)(?:[.-]|$)|package(?:-lock)?\.json$|\.codex\/zdm-project-workflow\.yaml$)/.test(
      file,
    ),
  );
}
export function deliveryCiCapability(
  root,
  execute = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, 'CI capability unavailable');
    return result.stdout;
  },
) {
  try {
    const repository = JSON.parse(execute('gh', ['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    const protection = JSON.parse(execute('gh', ['api', `repos/${repository}/branches/main/protection`]));
    assert.equal(protection.enforce_admins?.enabled, true);
    assert.equal(protection.required_status_checks?.strict, true);
    for (const context of ['Frontend quality', 'Backend quality'])
      assert.ok(protection.required_status_checks.contexts.includes(context));
    const workflow = JSON.parse(execute('gh', ['api', `repos/${repository}/actions/workflows/quality.yml`]));
    assert.equal(workflow.state, 'active');
    assert.equal(workflow.path, '.github/workflows/quality.yml');
    return { verified: true, repository, workflow: workflow.id, checkedAt: new Date().toISOString() };
  } catch {
    return {
      verified: false,
      reason: 'CI availability or required protection could not be proven; full local fallback required',
    };
  }
}
export function localReadinessTasks(root, files, env) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const task = (name, script, args = []) => ({
    root,
    name,
    command,
    args: ['run', script, ...args],
    env,
    reuse: false,
  });
  const existing = files.filter((file) => existsSync(path.resolve(root, file)));
  const tasks = [];
  const scriptFiles = existing.filter((file) => /\.(?:[cm]?js|ts|tsx|vue)$/.test(file) && !file.startsWith('backend/'));
  if (scriptFiles.length) tasks.push(task('changed lint', 'lint:changed', ['--', ...scriptFiles]));
  if (existing.some((file) => /\.(?:ts|tsx|vue)$/.test(file) && !file.startsWith('backend/')))
    tasks.push(task('typecheck', 'typecheck:cached'));
  const styles = existing.filter((file) => file.startsWith('src/') && /\.(css|vue)$/.test(file));
  if (styles.length) tasks.push(task('changed styles', 'stylelint:changed', ['--', ...styles]));
  if (files.some((file) => /^(src\/|tests\/|vite|playwright)/.test(file)))
    tasks.push(task('source guards', 'test:source-guards'));
  const units = existing.filter((file) => file.startsWith('src/') && /\.(ts|tsx|vue)$/.test(file));
  if (units.length) tasks.push(task('related unit tests', 'test:related', ['--', ...units]));
  const changedTests = existing.filter((file) => /^scripts\/.*\.test\.mjs$/.test(file));
  if (changedTests.length) tasks.push(task('changed script tests', 'test:scripts:files', ['--', ...changedTests]));
  return tasks;
}

export function requiresLocalRiskGate(files) {
  return files.some(
    (file) =>
      /^(?:backend\/src\/main\/|backend\/(?:pom\.xml|Dockerfile)|docker|compose|\.env|src\/router\/|src\/services\/|scripts\/(?:backend-runtime|dev-task|delivery-launcher|sync-integration)|\.codex\/zdm-project-workflow\.yaml)/.test(
        file,
      ) ||
      (/^src\//.test(file) && /(?:auth|security|permission|functionCatalog|adminPermissions)/i.test(file)),
  );
}
