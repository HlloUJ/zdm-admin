import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  lstatSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./task-cleanup-delete.py', import.meta.url));
function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cleanup-fd-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const target = path.join(base, 'deleting'),
    victim = path.join(base, 'foreign');
  mkdirSync(target);
  mkdirSync(victim);
  writeFileSync(path.join(target, 'generated'), 'generated');
  writeFileSync(path.join(victim, 'unique'), 'keep');
  const entries = ['', 'generated'].map((relative) => {
    const s = lstatSync(path.join(target, relative), { bigint: true });
    return {
      path: relative,
      kind: relative ? 'file' : 'directory',
      dev: String(s.dev),
      ino: String(s.ino),
      size: Number(s.size),
      mtimeNs: String(s.mtimeNs),
      ctimeNs: relative ? String(s.ctimeNs) : null,
      mode: Number(s.mode),
    };
  });
  return { base, target, victim, entries };
}
const injection = String.raw`
import io,json,os,sys
args=json.load(sys.stdin)
namespace={'__name__':'isolated_fixture'}
with open(args['helper']) as source: exec(compile(source.read(),args['helper'],'exec'),namespace)
original=os.unlink
injected=False
def unlink(name,*,dir_fd=None):
 global injected
 original(name,dir_fd=dir_fd)
 if not injected:
  injected=True
  if args['mode']=='new-file':
   fd=os.open('new-unique',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600,dir_fd=dir_fd)
   os.write(fd,b'keep');os.close(fd)
  elif args['mode']=='replace-parent':
   os.rename(args['request']['path'],args['request']['path']+'-preserved')
   os.symlink(args['victim'],args['request']['path'])
os.unlink=unlink
sys.stdin=io.StringIO(json.dumps(args['request']))
namespace['main']()
`;
test('a file created during descriptor deletion remains and prevents successful completion', (t) => {
  const f = fixture(t);
  const result = spawnSync('python3', ['-I', '-c', injection], {
    encoding: 'utf8',
    input: JSON.stringify({
      helper,
      mode: 'new-file',
      victim: f.victim,
      request: { path: f.target, entries: f.entries },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(f.target, 'new-unique'), 'utf8'), 'keep');
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
});
test('a replaced deletion parent cannot redirect descriptor removal into foreign content', (t) => {
  const f = fixture(t);
  const result = spawnSync('python3', ['-I', '-c', injection], {
    encoding: 'utf8',
    input: JSON.stringify({
      helper,
      mode: 'replace-parent',
      victim: f.victim,
      request: { path: f.target, entries: f.entries },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.ok(lstatSync(f.target).isSymbolicLink());
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
  assert.ok(existsSync(f.target + '-preserved'));
});
test('an inventory for a different directory refuses removal before touching files', (t) => {
  const f = fixture(t);
  const result = spawnSync('python3', ['-I', helper], {
    encoding: 'utf8',
    input: JSON.stringify({ path: f.victim, entries: f.entries }),
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
  assert.equal(readFileSync(path.join(f.target, 'generated'), 'utf8'), 'generated');
});
