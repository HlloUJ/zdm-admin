import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  backendContainerImages,
  captureIdentity,
  captureSource,
  evidenceMissReason,
} from './verification-evidence.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-verification-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file, content) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const pkg = {
    name: 'scope-fixture',
    scripts: { 'backend:test': 'docker compose run --rm --no-deps backend-tools mvn -B test', frontend: 'vite build' },
    dependencies: { vue: '1.0.0' },
  };
  write('package.json', pkg);
  write('package-lock.json', '{}');
  write('.gitignore', '.task-verification/\nnode_modules/\nbackend/target/\n');
  write(
    'backend/pom.xml',
    '<project><version>0.1.0-SNAPSHOT</version><dependencies><dependency><version>1.0.0</version></dependency></dependencies></project>',
  );
  write(
    'backend/src/test/java/example/OneTest.java',
    'package example; class OneTest { Object db = new MySQLContainer<>("mysql:8.0"); }',
  );
  write('backend/src/main/java/example/Service.java', 'package example; class Service {}');
  write('docs/guide.md', 'guide');
  write('src/app.ts', 'frontend');
  write('scripts/verification-runner.mjs', "import { check } from './validation-policy.mjs';\n");
  write('scripts/validation-policy.mjs', 'export const check = true;');
  write('docker-compose.yml', 'mock compose input');
  for (const args of [
    ['init', '--initial-branch=main'],
    ['config', 'user.email', 'scope@example.invalid'],
    ['config', 'user.name', 'Scope fixture'],
    ['add', '.'],
    ['commit', '-m', 'fixture', '--no-verify'],
    ['update-ref', 'refs/remotes/origin/main', 'HEAD'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const config = {
    name: 'fixture',
    services: {
      'backend-tools': {
        image: 'maven:fixed',
        working_dir: '/workspace/backend',
        volumes: [
          { type: 'bind', source: root, target: '/workspace' },
          { type: 'volume', source: 'maven', target: '/root/.m2' },
        ],
        networks: { default: null },
      },
      frontend: { image: 'nginx:unrelated' },
    },
    volumes: { maven: { name: 'shared-maven' }, unrelated: { name: 'unused-volume' } },
    networks: { default: { name: 'fixture-default' } },
  };
  const state = {
    config,
    imageId: 'sha256:used-image',
    helperId: 'sha256:ryuk',
    maven: 'a'.repeat(64),
    unrelatedImageId: 'sha256:unrelated',
  };
  const probes = [];
  const captureCommand = (_root, command, args) => {
    assert.equal(command, 'docker');
    probes.push(args);
    if (args.includes('config')) return JSON.stringify(state.config);
    if (args[0] === 'image' && args[1] === 'inspect') return `${state.imageId}:${args.at(-1)}`;
    if (args[0] === 'image' && args[1] === 'ls') {
      assert.ok(args.includes('--filter=reference=testcontainers/*'));
      return `testcontainers/ryuk:0.7.0 ${state.helperId}`;
    }
    if (args[0] === 'version') return '{"server":"stable","client":"stable"}';
    if (args.includes('version')) return '2.0.0';
    if (args.includes('run')) return `${state.maven}  -`;
    throw new Error(`Unexpected probe: ${args}`);
  };
  const task = {
    root,
    name: 'backend tests',
    command: 'npm',
    args: ['run', 'backend:test'],
    kind: 'backend',
    env: { PATH: process.env.PATH, HOME: os.homedir() },
  };
  const inspect = () => captureIdentity(task, { captureCommand });
  return { root, write, pkg, task, state, inspect, probes };
}

test('backend evidence ignores unrelated docs, frontend files/dependencies, npm scripts and Docker services/images', (t) => {
  const f = fixture(t);
  const before = f.inspect();
  assert.equal(before.reusable, true, before.reason);
  assert.equal(before.identity.inputScope.name, 'backend-maven');
  assert.equal('dependencies' in before.identity.environment, false);
  const fullBefore = captureSource(f.root).digest;
  f.write('docs/guide.md', 'changed guide');
  f.write('src/app.ts', 'changed frontend');
  f.write('src/new-component.ts', 'new unrelated file');
  f.pkg.dependencies.vue = '2.0.0';
  f.pkg.scripts.frontend = 'vite build --mode production';
  f.write('package.json', f.pkg);
  f.write('package-lock.json', '{"frontend":"new version"}');
  f.write('node_modules/vue/index.js', 'changed installed frontend dependency');
  f.state.config.services.frontend.image = 'nginx:different';
  f.state.config.volumes.unrelated.name = 'other-volume';
  f.state.unrelatedImageId = 'sha256:other';
  assert.equal(f.inspect().fingerprint, before.fingerprint);
  assert.notEqual(
    captureSource(f.root).digest,
    fullBefore,
    'full-candidate guard must still observe unrelated changes',
  );
  assert.deepEqual(
    f.probes
      .filter((args) => args[0] === 'image' && args[1] === 'inspect')
      .map((args) => args.at(-1))
      .slice(0, 2),
    ['maven:fixed', 'mysql:8.0'],
  );
});

test('backend code, deleted/new files, npm command, local helper and used compose/image inputs invalidate', (t) => {
  const f = fixture(t);
  const mutateAndCheck = (mutate) => {
    const before = f.inspect();
    assert.equal(before.reusable, true, before.reason);
    mutate();
    const after = f.inspect();
    assert.notEqual(after.fingerprint, before.fingerprint);
    return { before, after };
  };
  mutateAndCheck(() =>
    f.write('backend/src/main/java/example/Service.java', 'package example; class Service { int x; }'),
  );
  mutateAndCheck(() => f.write('backend/src/test/java/example/NewTest.java', 'package example; class NewTest {}'));
  mutateAndCheck(() => rmSync(path.join(f.root, 'backend/src/main/java/example/Service.java')));
  mutateAndCheck(() => f.write('scripts/validation-policy.mjs', 'export const check = false;'));
  mutateAndCheck(() => f.write('.npmrc', 'ignore-scripts=true'));
  mutateAndCheck(() => f.write('.mvn/maven.config', '-Dsetting=changed'));
  mutateAndCheck(() => {
    f.pkg.scripts['backend:test'] += ' -DtrimStackTrace=false';
    f.write('package.json', f.pkg);
  });
  mutateAndCheck(() => {
    f.state.config.services['backend-tools'].environment = { TEST_SETTING: 'changed' };
  });
  mutateAndCheck(() => {
    f.state.imageId = 'sha256:changed-image';
  });
  const { before, after } = mutateAndCheck(() => {
    f.state.maven = 'b'.repeat(64);
  });
  assert.match(
    evidenceMissReason(
      {
        version: before.identity.version,
        status: 'passed',
        exitCode: 0,
        identity: before.identity,
        fingerprint: before.fingerprint,
      },
      after,
      null,
    ),
    /Maven dependency/,
  );
  assert.match(after.identity.inputScope.limitations.join(' '), /other projects/);
});

test('unknown npm command graph or lifecycle hooks conservatively disable backend reuse', (t) => {
  const f = fixture(t);
  f.pkg.scripts['prebackend:test'] = 'node scripts/custom-setup.mjs';
  f.write('package.json', f.pkg);
  const hooked = f.inspect();
  assert.equal(hooked.reusable, false);
  assert.equal(hooked.identity.inputScope.name, 'full-candidate');
  assert.match(hooked.reason, /not mapped/);
  delete f.pkg.scripts['prebackend:test'];
  f.pkg.scripts['backend:test'] = 'node scripts/custom-maven-wrapper.mjs';
  f.write('package.json', f.pkg);
  assert.equal(f.inspect().reusable, false);
});

test('literal and local constant Testcontainers images are proven; dynamic references require fresh execution', (t) => {
  const f = fixture(t);
  f.write(
    'backend/src/test/java/example/OneTest.java',
    'package example; class OneTest { static final String IMAGE = "mysql:8.0"; Object db = new MySQLContainer<>(IMAGE); }',
  );
  assert.deepEqual(backendContainerImages(f.root, ['backend/src/test/java/example/OneTest.java']), ['mysql:8.0']);
  assert.equal(f.inspect().reusable, true);
  f.write(
    'backend/src/test/java/example/OneTest.java',
    'package example; class OneTest { Object db = new MySQLContainer<>(System.getenv("IMAGE")); }',
  );
  const unknown = f.inspect();
  assert.equal(unknown.reusable, false);
  assert.match(unknown.reason, /Dynamic container image/);
});

test('project SNAPSHOT version is harmless, mutable dependency versions and unknown external mounts disable reuse', (t) => {
  const f = fixture(t);
  assert.equal(f.inspect().reusable, true);
  f.write(
    'backend/pom.xml',
    '<project><dependencies><dependency><version>1.0-SNAPSHOT</version></dependency></dependencies></project>',
  );
  assert.equal(f.inspect().reusable, false);
  f.write('backend/pom.xml', '<project><version>0.1-SNAPSHOT</version></project>');
  f.state.config.services['backend-tools'].volumes.push({ type: 'bind', source: '/external/data', target: '/data' });
  const external = f.inspect();
  assert.equal(external.reusable, false);
  assert.match(external.reason, /external backend volume/);
});

test('scope changes record actionable miss reasons', (t) => {
  const f = fixture(t);
  const before = f.inspect();
  f.write('backend/pom.xml', `${readFileSync(path.join(f.root, 'backend/pom.xml'), 'utf8')}\n`);
  const after = f.inspect();
  assert.match(
    evidenceMissReason(
      { version: before.identity.version, status: 'passed', exitCode: 0, identity: before.identity },
      after,
      null,
    ),
    /backend-maven inputs/,
  );
});
