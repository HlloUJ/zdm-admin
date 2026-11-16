import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryStandardPlan } from './delivery-standard.mjs';
import { classifyChangedFiles } from './verification-impact.mjs';

export function checkChangedDocumentContracts(root, files) {
  root = realpathSync(root);
  return files
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const absolute = path.resolve(root, file);
      assert.ok(absolute.startsWith(root + path.sep), 'Document outside current project');
      if (!existsSync(absolute)) return { file, status: 'deleted', references: [] };
      const source = readFileSync(absolute, 'utf8'),
        references = [];
      const markup = source
        .replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '\n')
        .replace(/`[^`\n]*`/g, '');
      // Only explicit internal Markdown references in the changed document. No
      // historical crawl, external HTTP requests or browser inspection.
      for (const match of markup.matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)/g)) {
        const raw = match[1].replace(/^<|>$/g, '');
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) continue;
        const targetPart = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
        if (!targetPart) continue;
        const target = path.resolve(path.dirname(absolute), targetPart);
        assert.ok(
          target === root || target.startsWith(root + path.sep),
          'Reference escapes current project: ' + file + ' -> ' + raw,
        );
        assert.ok(existsSync(target), 'Missing internal reference: ' + file + ' -> ' + raw);
        assert.ok(
          realpathSync(target) === root || realpathSync(target).startsWith(root + path.sep),
          'Reference resolves outside project',
        );
        references.push(raw);
      }
      assert.ok(!/^(?:<{7}|={7}|>{7})(?:\s|$)/m.test(source), 'Unresolved document conflict marker: ' + file);
      return { file, status: 'passed', references: [...new Set(references)].sort() };
    });
}
export function checkDeliveryInputs(
  root,
  { files, candidate, standardDigest, base = null },
  {
    git = (args) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, 'Delivery diff contract failed: ' + result.stderr);
      return result.stdout.trim();
    },
  } = {},
) {
  assert.ok(Array.isArray(files) && files.every((f) => typeof f === 'string'));
  for (const file of files)
    assert.ok(file && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Invalid affected path');
  const args = ['diff', '--check', ...(base ? [base, candidate] : ['HEAD']), '--'];
  assert.equal(git(args), '', 'Difference has whitespace or conflict errors');
  const documents = checkChangedDocumentContracts(root, files);
  return {
    version: 1,
    candidate,
    base,
    standardDigest,
    files: [...new Set(files)].sort(),
    diff: { status: 'passed', command: ['git', ...args] },
    documents,
    complete: true,
  };
}
export function main(root = process.cwd(), args = process.argv.slice(2)) {
  const ci = args.length ? null : process.env.CI_EVIDENCE_DIR;
  let scope, files, candidate, base, standard;
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, 'Input identity unavailable');
    return r.stdout.trim();
  };
  if (args.length) {
    assert.equal(args[0], '--files-json');
    files = JSON.parse(args[1]);
    candidate = git(['rev-parse', 'HEAD']);
    standard = deliveryStandardPlan({ files, impact: classifyChangedFiles(files) });
  } else {
    assert.ok(ci, 'Exact CI scope required');
    scope = JSON.parse(readFileSync(path.join(ci, 'scope.json'), 'utf8'));
    files = scope.standard.files;
    candidate = scope.identity.candidateSha;
    base = scope.proof === 'verified' ? scope.identity.baseSha : null;
    standard = scope.standard;
    assert.equal(git(['rev-parse', 'HEAD']), candidate);
  }
  const result = checkDeliveryInputs(root, { files, candidate, base, standardDigest: standard.standardDigest });
  const directory = ci ?? path.join(root, '.task-verification');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'delivery-input-contracts.json'), JSON.stringify(result, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(`Delivery input contracts: diff and ${result.documents.length} changed documents passed`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
