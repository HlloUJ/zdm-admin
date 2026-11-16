import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createdCleanupFixture } from './cleanup-created-fixture.mjs';
import { npmDigest } from '../task-cleanup-npm-proof.mjs';
export function dependencyArchive(
  files = [
    { name: 'package/package.json', text: '{"name":"example","version":"1.0.0"}' },
    { name: 'package/index.js', text: 'export default 1;' },
  ],
) {
  return execFileSync(
    'python3',
    [
      '-I',
      '-c',
      `import io,sys,json,tarfile
out=io.BytesIO()
with tarfile.open(fileobj=out,mode='w:gz') as tar:
 for item in json.load(sys.stdin):
  info=tarfile.TarInfo(item['name']);info.mode=item.get('mode',420)
  if 'link' in item: info.type=tarfile.SYMTYPE;info.linkname=item['link'];tar.addfile(info)
  else:
   data=item['text'].encode();info.size=len(data);tar.addfile(info,io.BytesIO(data))
sys.stdout.buffer.write(out.getvalue())`,
    ],
    { input: JSON.stringify(files) },
  );
}
export function dependencyAuditFixture(t, { installScript = false, nested = false } = {}) {
  const f = createdCleanupFixture(t),
    bytes = dependencyArchive(),
    hash = createHash('sha512').update(bytes).digest(),
    integrity = 'sha512-' + hash.toString('base64'),
    hex = hash.toString('hex');
  const relative = 'node_modules/example',
    source = path.join(f.root, relative),
    lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { example: '1.0.0' } },
        [relative]: {
          version: '1.0.0',
          integrity,
          resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
          ...(installScript ? { hasInstallScript: true } : {}),
        },
        ...(nested ? { 'node_modules/example/node_modules/other': { version: '1.0.0', integrity } } : {}),
      },
    };
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, 'package.json'), '{"name":"example","version":"1.0.0"}');
  writeFileSync(path.join(source, 'index.js'), 'export default 1;');
  writeFileSync(path.join(f.root, 'package.json'), '{"dependencies":{"example":"1.0.0"}}');
  writeFileSync(path.join(f.root, 'package-lock.json'), JSON.stringify(lock));
  f.git(f.root, 'add', 'package.json', 'package-lock.json');
  f.git(f.root, 'commit', '-m', 'exact audited package lock');
  const head = f.git(f.root, 'rev-parse', 'HEAD');
  f.proof = { worktree: f.root, head, accepted: head, main: head };
  const cache = path.join(
    f.root,
    '.task-runtime/npm-cache/_cacache/content-v2/sha512',
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4),
  );
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, bytes);
  const artifact = path.join(f.root, '.task-runtime/task-artifacts.json');
  writeFileSync(
    artifact,
    JSON.stringify({
      version: 1,
      ready: true,
      task: 'created-task',
      worktree: f.root,
      branch: 'codex/created-task',
      dependencies: { status: 'private-validated', modules: path.join(f.root, 'node_modules') },
      lockDigest: npmDigest(readFileSync(path.join(f.root, 'package-lock.json'))),
    }),
    { mode: 0o600 },
  );
  const parameters = { root: f.root, common: f.common, task: 'created-task' };
  return { ...f, bytes, integrity, source, cache, artifact, parameters };
}
