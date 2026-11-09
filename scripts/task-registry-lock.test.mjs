import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withTaskRegistryWriteLock } from './task-registry.mjs';

function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'registry-lock-contract-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lock = path.join(directory, 'write.lock'),
    file = path.join(lock, 'owner.json');
  function occupied(owner) {
    mkdirSync(lock);
    if (owner) writeFileSync(file, JSON.stringify(owner));
  }
  return { directory, lock, file, occupied };
}
test('operation exceptions release only this exact registry write nonce', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      withTaskRegistryWriteLock(f.directory, () => {
        throw Error('operation failed');
      }),
    /operation failed/,
  );
  assert.equal(existsSync(f.lock), false);
});
for (const [name, owner, options] of [
  ['dead writer', { pid: 12345, token: 'original' }, { alive: () => false }],
  ['recursive writer', { pid: process.pid, token: 'original' }, {}],
  [
    'unknown process',
    { pid: 12345, token: 'original' },
    {
      alive: () => {
        throw Object.assign(Error('unknown'), { code: 'EPERM' });
      },
    },
  ],
  ['invalid owner', { pid: 0, token: 'original' }, {}],
  ['missing owner', null, {}],
  ['live owner exceeding the bound', { pid: 12345, token: 'original' }, { alive: () => true }],
])
  test('contention retains ' + name + ' without deleting or executing an update', (t) => {
    const f = fixture(t);
    f.occupied(owner);
    let clock = 0,
      called = 0;
    const before = owner && readFileSync(f.file);
    assert.throws(() =>
      withTaskRegistryWriteLock(f.directory, () => called++, {
        now: () => clock,
        pause: () => {
          clock += 10;
        },
        timeoutMs: 30,
        publicationMs: 20,
        ...options,
      }),
    );
    assert.equal(called, 0);
    assert.ok(existsSync(f.lock));
    if (owner) assert.deepEqual(readFileSync(f.file), before);
  });
test('ownership replacement during the update is retained instead of released', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      withTaskRegistryWriteLock(f.directory, () =>
        writeFileSync(f.file, JSON.stringify({ pid: process.pid, token: 'foreign' })),
      ),
    /ownership changed/,
  );
  assert.equal(JSON.parse(readFileSync(f.file)).token, 'foreign');
});
test('a linked registry lock never becomes an owned write scope', (t) => {
  const f = fixture(t),
    other = path.join(f.directory, 'other');
  mkdirSync(other);
  symlinkSync(other, f.lock);
  assert.throws(() => withTaskRegistryWriteLock(f.directory, () => assert.fail('must not write')), /symlink/);
  assert.ok(existsSync(f.lock));
});
test('a writer that released normally before its PID probe does not leave a false dead-owner failure', (t) => {
  const f = fixture(t);
  f.occupied({ pid: 12345, token: 'released-normally' });
  let updates = 0;
  withTaskRegistryWriteLock(f.directory, () => updates++, {
    alive: () => {
      rmSync(f.lock, { recursive: true });
      return false;
    },
  });
  assert.equal(updates, 1);
  assert.equal(existsSync(f.lock), false);
});
test('the ended writer probe rechecks the nonce of a replacement writer before diagnosing an orphan', (t) => {
  const f = fixture(t);
  f.occupied({ pid: 12345, token: 'observed' });
  let updated = 0,
    paused = 0;
  withTaskRegistryWriteLock(f.directory, () => updated++, {
    alive: () => {
      writeFileSync(f.file, JSON.stringify({ pid: 12346, token: 'replacement' }));
      return false;
    },
    pause: (owner) => {
      assert.equal(owner.token, 'replacement');
      paused++;
      rmSync(f.lock, { recursive: true });
    },
  });
  assert.equal(updated, 1);
  assert.equal(paused, 1);
});
test(
  'three real processes preserve a writer replacement between owner read and PID observation',
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      url = new URL('./task-registry.mjs', import.meta.url).href;
    const code = `import fs from 'node:fs';import path from 'node:path';
    const [url,dir,role]=process.argv.slice(1),{withTaskRegistryWriteLock}=await import(url);
    const cell=new Int32Array(new SharedArrayBuffer(4)),end=Date.now()+5000;
    const file=n=>path.join(dir,n), wait=fn=>{while(!fn()){if(Date.now()>end)throw Error('barrier expired: '+role);Atomics.wait(cell,0,0,2);}};
    const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
    if(role!=='a')wait(()=>fs.existsSync(file('a-ready')));
    const first=role==='a'?null:JSON.parse(fs.readFileSync(file('a-ready')));
    withTaskRegistryWriteLock(dir,()=>{
      if(role==='a'){fs.writeFileSync(file('a-ready'),JSON.stringify({pid:process.pid}));wait(()=>fs.existsSync(file('c-observed-a')));}
      if(role==='b'){fs.writeFileSync(file('b-ready'),'ready');wait(()=>fs.existsSync(file('release-b')));}
      if(role==='c')fs.writeFileSync(file('c-finished'),'passed');
    },{alive:pid=>{
      if(role==='c'&&pid===first.pid){fs.writeFileSync(file('c-observed-a'),'ready');wait(()=>fs.existsSync(file('b-ready'))&&!alive(pid));return false;}
      return alive(pid);
    },pause:owner=>{if(role==='c'&&owner&&owner.pid!==first.pid)fs.writeFileSync(file('release-b'),'ready');Atomics.wait(cell,0,0,2);}});`;
    const outcomes = await Promise.all(
      ['a', 'b', 'c'].map(
        (role) =>
          new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['--input-type=module', '-e', code, url, f.directory, role], {
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            child.stdout.on('data', (value) => (output += value));
            child.stderr.on('data', (value) => (output += value));
            child.once('error', reject);
            child.once('exit', (status, signal) => resolve({ role, status, signal, output }));
          }),
      ),
    );
    for (const outcome of outcomes) assert.equal(outcome.status, 0, JSON.stringify(outcome));
    assert.equal(readFileSync(path.join(f.directory, 'c-finished'), 'utf8'), 'passed');
    assert.equal(existsSync(f.lock), false);
  },
);
test(
  'two real processes serialize the same metadata critical section after proven live contention',
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      moduleUrl = new URL('./task-registry.mjs', import.meta.url).href;
    const code = `
    import fs from 'node:fs';import path from 'node:path';
    const [url,directory,role]=process.argv.slice(1),{withTaskRegistryWriteLock}=await import(url);
    const wait=new Int32Array(new SharedArrayBuffer(4)),deadline=Date.now()+5000;
    if(role==='b')while(!fs.existsSync(path.join(directory,'held-a'))){if(Date.now()>deadline)throw Error('source owner absent');Atomics.wait(wait,0,0,2);}
    withTaskRegistryWriteLock(directory,()=>{
      const owner=JSON.parse(fs.readFileSync(path.join(directory,'write.lock/owner.json')));
      if(owner.pid!==process.pid)throw Error('wrong actual owner');
      if(role==='a'){fs.writeFileSync(path.join(directory,'held-a'),JSON.stringify(owner));while(!fs.existsSync(path.join(directory,'b-observed-contention'))){if(Date.now()>deadline)throw Error('actual contention was not observed');Atomics.wait(wait,0,0,2);}}
      const file=path.join(directory,'updates.json'),before=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];
      fs.writeFileSync(file,JSON.stringify([...before,role]));
    },{pause:owner=>{if(role==='b'&&owner&&!fs.existsSync(path.join(directory,'b-observed-contention'))){fs.writeFileSync(path.join(directory,'b-observed-contention'),JSON.stringify(owner));}Atomics.wait(wait,0,0,2);}});
  `;
    const children = ['a', 'b'].map((role) =>
      spawn(process.execPath, ['--input-type=module', '-e', code, moduleUrl, f.directory, role], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    const outcomes = await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve, reject) => {
            let output = '';
            child.stdout.on('data', (v) => (output += v));
            child.stderr.on('data', (v) => (output += v));
            child.once('error', reject);
            child.once('close', (code) => resolve({ code, output }));
          }),
      ),
    );
    assert.ok(
      outcomes.every((outcome) => outcome.code === 0),
      JSON.stringify(outcomes),
    );
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.directory, 'updates.json'))), ['a', 'b']);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(f.directory, 'b-observed-contention'))),
      JSON.parse(readFileSync(path.join(f.directory, 'held-a'))),
    );
    assert.equal(existsSync(f.lock), false);
  },
);
