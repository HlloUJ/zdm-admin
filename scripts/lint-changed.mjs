import { ESLint } from 'eslint';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Filter only explicit existing source paths. Other ESLint CLI modes (stdin,
// globs, custom config/options) are passed through untouched, never guessed.
export async function selectLintArguments(args, root = process.cwd()) {
  const indexes = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--cache-location') {
      if (!args[++index]) return { args, allIgnored: false };
    } else if (['--cache', '--no-cache'].includes(arg) || /^--max-warnings=\d+$/.test(arg)) continue;
    else if (
      !arg.startsWith('-') &&
      /\.(?:[cm]?js|tsx?|vue)$/.test(arg) &&
      !/[*?{}[\]]/.test(arg) &&
      existsSync(path.resolve(root, arg))
    )
      indexes.push(index);
    else return { args, allIgnored: false };
  }
  if (!indexes.length) return { args, allIgnored: false };
  const eslint = new ESLint({ cwd: root });
  const ignored = new Set();
  for (const index of indexes) if (await eslint.isPathIgnored(path.resolve(root, args[index]))) ignored.add(index);
  return { args: args.filter((_, index) => !ignored.has(index)), allIgnored: ignored.size === indexes.length };
}

export async function runChangedLint(args, root = process.cwd()) {
  const selected = await selectLintArguments(args, root);
  if (selected.allIgnored) {
    console.log('All explicit lint inputs are ignored by the existing ESLint configuration.');
    return 0;
  }
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js');
  const result = spawnSync(process.execPath, [cli, ...selected.args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runChangedLint(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
