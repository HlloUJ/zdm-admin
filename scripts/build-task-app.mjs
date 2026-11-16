import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSource } from './verification-evidence.mjs';
import { registerBuiltDist } from './task-cleanup-handoff.mjs';

export async function buildTaskApp(
  root,
  {
    execute = spawnSync,
    capture = captureSource,
    register = registerBuiltDist,
    hasTaskArtifacts = () => existsSync(path.join(root, '.task-runtime/task-artifacts.json')),
  } = {},
) {
  // CI and ordinary retained checkouts have no task-owned output registration.
  // Preserve their original build behavior, including shallow checkout support.
  const owned = hasTaskArtifacts();
  const before = owned ? capture(root) : null;
  const result = execute(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'runner'],
    { cwd: root, stdio: 'inherit', env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) return result.status ?? 1;
  if (!owned) return 0;
  if (capture(root).digest !== before.digest)
    throw new Error('Build inputs changed; generated output is retained and cannot authorize cleanup');
  await register(root, before.digest);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await buildTaskApp(process.cwd());
