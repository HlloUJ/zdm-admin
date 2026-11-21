import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, lstatSync, existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { scopeFixture } from './delivery-repairs/test-support/task-cleanup-scope-fixture.mjs';

async function fixture(t) {
  const f = await scopeFixture(t);
  const target = path.join(f.approved.record.carrier, 'deleting'),
    victim = path.join(f.root, 'foreign');
  renameSync(f.approved.target, target);
  mkdirSync(victim);
  writeFileSync(path.join(victim, 'unique'), 'keep');
  const entries = ['', 'app.js'].map((relative) => {
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
  const record = { ...f.approved.record, key: f.approved.key, state: 'pending' };
  const scopeProof = f.scope().assertRecord(f.approved.key, record);
  return { helper: f.helper, target, victim, entries, scopeProof };
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
test('a file created during descriptor deletion remains and prevents successful completion', async (t) => {
  const f = await fixture(t);
  const result = spawnSync('python3', ['-I', '-c', injection], {
    encoding: 'utf8',
    input: JSON.stringify({
      helper: f.helper,
      mode: 'new-file',
      victim: f.victim,
      request: { path: f.target, entries: f.entries, scopeProof: f.scopeProof },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(f.target, 'new-unique'), 'utf8'), 'keep');
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
});
test('a replaced deletion parent cannot redirect descriptor removal into foreign content', async (t) => {
  const f = await fixture(t);
  const result = spawnSync('python3', ['-I', '-c', injection], {
    encoding: 'utf8',
    input: JSON.stringify({
      helper: f.helper,
      mode: 'replace-parent',
      victim: f.victim,
      request: { path: f.target, entries: f.entries, scopeProof: f.scopeProof },
    }),
  });
  assert.notEqual(result.status, 0);
  assert.ok(lstatSync(f.target).isSymbolicLink());
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
  assert.ok(existsSync(f.target + '-preserved'));
});
test('an inventory for a different directory refuses removal before touching files', async (t) => {
  const f = await fixture(t);
  const result = spawnSync('python3', ['-I', f.helper], {
    encoding: 'utf8',
    input: JSON.stringify({ path: f.victim, entries: f.entries, scopeProof: f.scopeProof }),
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(path.join(f.victim, 'unique'), 'utf8'), 'keep');
  assert.equal(readFileSync(path.join(f.target, 'app.js'), 'utf8'), 'approved');
});
