import { BACKEND_REPORTS, backendCollectedPath } from './ci-report-contract.mjs';
// CI-only backend contract. Never reads a project database or a developer Maven credential file into artifacts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPaths, backendContainerImages } from './verification-evidence.mjs';
import { validateBackendReports } from './backend-test-evidence.mjs';

export const BACKEND_CONTRACT = 'backend-maven-testcontainers-v1';
export const BACKEND_COMMAND = ['mvn', '-B', 'test', 'checkstyle:check', 'spotbugs:check', 'jacoco:report'];
const hash = (v) => createHash('sha256').update(v).digest('hex');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, v) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const command = (p, a = []) =>
  execFileSync(p, a, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 }).trim();
export function backendFiles(root) {
  return command('git', ['-C', root, 'ls-files', '-z']).split('\0').filter(Boolean).sort();
}
function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const p = path.join(root, e.name);
      assert.ok(!e.isSymbolicLink(), 'Linked evidence or dependency is unsupported');
      return e.isDirectory() ? files(p) : [p];
    });
}
export function backendExecutionEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k]) =>
        /^(?:PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_.*|TZ|CI|GITHUB_ACTIONS|CI_EVIDENCE_DIR|JAVA_HOME|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|MAVEN_.*|M2_HOME|DOCKER_.*|TESTCONTAINERS_.*|SPRING_.*|ZDM_.*)$/.test(
          k,
        ),
      )
      .sort(),
  );
}
function checksum(p) {
  return existsSync(p) ? hash(readFileSync(p)) : 'absent';
}
export function validateMavenEntries(entries) {
  assert.ok(
    Array.isArray(entries) && entries.length > 0 && entries.length < 20000,
    'Missing or excessive Maven inventory',
  );
  const seen = new Set();
  for (const e of entries) {
    assert.match(e.path, /^[a-zA-Z0-9_./+-]+\.(?:jar|pom)$/, 'Unsupported dependency path');
    assert.ok(
      !e.path.startsWith('/') &&
        !e.path.split('/').some((p) => ['.', '..', ''].includes(p)) &&
        !/SNAPSHOT/i.test(e.path),
      'Mutable or escaping Maven artifact',
    );
    assert.match(e.digest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(e.bytes) && e.bytes > 0 && e.bytes < 200 * 1024 * 1024);
    assert.ok(!seen.has(e.path), 'Duplicate Maven artifact');
    seen.add(e.path);
  }
}
export function mavenInventory(repo) {
  assert.ok(!existsSync(repo) || !lstatSync(repo).isSymbolicLink(), 'Linked Maven repository');
  const entries = files(repo)
    .filter((p) => /\.(?:jar|pom)$/.test(p))
    .map((p) => ({
      path: path.relative(repo, p).split(path.sep).join('/'),
      bytes: lstatSync(p).size,
      digest: checksum(p),
    }));
  validateMavenEntries(entries);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function backendRuntime(env = process.env, root = process.cwd()) {
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.equal(env.ImageOS, 'ubuntu24');
  assert.equal(os.cpus().length, 4);
  assert.ok(os.totalmem() >= 16000000000);
  assert.equal(
    command('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal']),
    '',
    'Dirty candidate',
  );
  const java = realpathSync(env.JAVA_HOME);
  const mvn = realpathSync(command('which', ['mvn'])),
    mavenHome = path.dirname(path.dirname(mvn));
  const testcontainers = testcontainersConfiguration(path.join(os.homedir(), '.testcontainers.properties'));
  const settings = [
    path.join(os.homedir(), '.m2/settings.xml'),
    path.join(mavenHome, 'conf/settings.xml'),
    path.join(os.homedir(), '.m2/toolchains.xml'),
  ];
  // Fixed same-tree config remains covered; reject overrides whose filesystem/dependency readers are unknown.
  assert.ok(
    !env.MAVEN_ARGS && !env.MAVEN_OPTS && !env.JAVA_TOOL_OPTIONS && !env.JDK_JAVA_OPTIONS && !env._JAVA_OPTIONS,
    'Unreviewed JVM/Maven options',
  );
  assert.ok(
    !Object.keys(env).some((k) => /^(?:TESTCONTAINERS_|DOCKER_|SPRING_|ZDM_)/.test(k)),
    'External service or container override',
  );
  for (const p of ['.mvn', 'backend/.mvn'])
    assert.ok(!existsSync(path.join(root, p)), 'Maven extension/config requires contract review');
  const pom = readFileSync(path.join(root, 'backend/pom.xml'), 'utf8');
  assert.ok(
    !/SNAPSHOT|<version>\s*(?:LATEST|RELEASE|[[(])|<(?:repositories|pluginRepositories|profiles|extensions)>/.test(pom),
    'Unreviewed Maven resolution',
  );
  const javaVersion = readFileSync(path.join(java, 'release'), 'utf8');
  // Release identity and the complete installed JDK are both bound to this contract.
  return {
    version: 1,
    contract: BACKEND_CONTRACT,
    job: 'backend_full',
    platform: ['linux', 'x64', 'ubuntu24'],
    resources: 'github-hosted-linux-x64-4cpu-16gb-functional-v1',
    image: [env.ImageOS, env.ImageVersion],
    kernel: os.release(),
    node: [process.version, checksum(process.execPath)],
    java: { home: java, version: javaVersion, content: hashPaths(java, ['.']) },
    maven: {
      version: command('mvn', ['--version']),
      content: hashPaths(mavenHome, ['.']),
      settings: settings.map(checksum),
    },
    packages: hash(command('dpkg-query', ['-W', '-f=${Package}=${Version}\n'])),
    systemFiles: hashPaths('/', ['etc/os-release']),
    environment: hash(JSON.stringify(backendExecutionEnvironment(env))),
    inputs: hash(
      backendFiles(root)
        .filter(
          (p) =>
            p.startsWith('backend/') ||
            p.startsWith('scripts/') ||
            ['package.json', 'package-lock.json', '.github/workflows/quality.yml', 'pom.xml'].includes(p),
        )
        .map((p) => p + '\0' + checksum(path.join(root, p)))
        .join('\n'),
    ),
    docker: {
      testcontainers,
      version: JSON.parse(command('docker', ['version', '--format', '{{json .}}'])),
      configuration: command('docker', [
        'info',
        '--format',
        '{{json .Driver}} {{json .DriverStatus}} {{json .CgroupDriver}} {{json .CgroupVersion}} {{json .SecurityOptions}} {{json .DefaultRuntime}} {{json .Runtimes}}',
      ]),
    },
  };
}
export function validateBackendProof(p) {
  assert.equal(p?.version, 1);
  assert.equal(p.contract, BACKEND_CONTRACT);
  assert.equal(p.job, 'backend_full');
  assert.deepEqual(p.platform, ['linux', 'x64', 'ubuntu24']);
  assert.equal(p.resources, 'github-hosted-linux-x64-4cpu-16gb-functional-v1');
  assert.deepEqual(
    Object.keys(p).sort(),
    [
      'version',
      'contract',
      'job',
      'platform',
      'resources',
      'image',
      'kernel',
      'node',
      'java',
      'maven',
      'packages',
      'systemFiles',
      'environment',
      'inputs',
      'docker',
      'dependencies',
      'images',
    ].sort(),
  );
  for (const k of ['packages', 'systemFiles', 'environment', 'inputs', 'dependencies'])
    assert.match(p[k], /^[a-f0-9]{64}$/);
  assert.match(p.java.content, /^[a-f0-9]{64}$/);
  assert.match(p.maven.content, /^[a-f0-9]{64}$/);
  assert.ok(p.images.length > 0);
  for (const i of p.images) {
    assert.match(i.reference, /^[a-z0-9][a-z0-9./:_-]*$/);
    assert.match(i.id, /^sha256:[a-f0-9]{64}$/);
    assert.ok(i.repoDigests.length > 0);
    for (const d of i.repoDigests) assert.match(d, /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);
  }
}
function imageInventory(root) {
  const refs = backendContainerImages(root, backendFiles(root));
  const helpers = command('docker', [
    'image',
    'ls',
    '--filter=reference=testcontainers/*',
    '--filter=reference=alpine:*',
    '--format',
    '{{.Repository}}:{{.Tag}}',
  ])
    .split('\n')
    .filter(Boolean);
  return [...new Set([...refs, ...helpers])].sort().map((reference) => {
    const i = JSON.parse(command('docker', ['image', 'inspect', reference]))[0];
    return { reference, id: i.Id, repoDigests: [...i.RepoDigests].sort() };
  });
}
export function recordBackendPreparation(directory, env = process.env, runtime = () => backendRuntime(env)) {
  try {
    save(path.join(directory, 'backend-preparation.json'), {
      runtime: runtime(),
      dependencies: mavenInventory(path.join(os.homedir(), '.m2/repository')),
    });
  } catch {
    // An empty first-run Maven cache is allowed; the final closure is collected only after success.
    try {
      save(path.join(directory, 'backend-preparation.json'), { runtime: runtime(), dependencies: [] });
    } catch (error) {
      if (existsSync(path.join(directory, 'metadata.json')))
        save(path.join(directory, 'backend-preparation-unavailable.json'), {
          reason: error.message.split('\n')[0].slice(0, 200),
        });
    }
  }
}
export function collectBackendEvidence(directory, root = process.cwd()) {
  const phase = read(path.join(directory, 'metadata.json')).phases.find((p) => p.name === 'backend-quality');
  assert.deepEqual(phase?.command, BACKEND_COMMAND);
  assert.equal(phase.exitCode, 0);
  for (const [to, from] of Object.entries(BACKEND_REPORTS)) {
    const src = path.join(root, 'backend/target', from);
    assert.ok(existsSync(src), `Missing backend report: ${from}`);
    assert.ok(!lstatSync(src).isSymbolicLink());
    for (const p of lstatSync(src).isDirectory() ? files(src) : [src])
      assert.ok(lstatSync(p).mtimeMs >= Date.parse(phase.startedAt) - 1000, 'Stale backend evidence');
    cpSync(src, path.join(directory, backendCollectedPath(to)), { recursive: true });
  }
  const payload = files(path.join(directory, 'reports')).map((p) => ({
    path: path.relative(directory, p).split(path.sep).join('/'),
    bytes: lstatSync(p).size,
    digest: checksum(p),
  }));
  const summary = validateBackendReports(root);
  save(path.join(directory, 'backend-tests.json'), summary);
  const evidence = {
    version: 1,
    files: payload,
    summary,
    classes: hashPaths(root, ['backend/target/classes', 'backend/target/test-classes']),
  };
  validateBackendEvidence(directory, evidence, root);
  return evidence;
}
export function captureBackendProof(directory, env = process.env, root = process.cwd()) {
  const before = read(path.join(directory, 'backend-preparation.json'));
  const runtime = backendRuntime(env, root);
  assert.deepEqual(runtime, before.runtime, 'Backend runtime changed during validation');
  const deps = mavenInventory(path.join(os.homedir(), '.m2/repository'));
  const byPath = new Map(deps.map((e) => [e.path, e]));
  for (const entry of before.dependencies)
    assert.deepEqual(byPath.get(entry.path), entry, 'An existing Maven dependency changed during validation');
  save(path.join(directory, 'maven-dependencies.json'), deps);
  const proof = { ...runtime, dependencies: hash(JSON.stringify(deps)), images: imageInventory(root) };
  validateBackendProof(proof);
  return proof;
}
export function validateBackendEvidence(directory, evidence, root = process.cwd()) {
  assert.equal(evidence?.version, 1);
  assert.match(evidence.classes, /^[a-f0-9]{64}$/);
  assert.ok(evidence.files.length > 0);
  assert.ok(!lstatSync(path.join(directory, 'reports')).isSymbolicLink());
  const seen = new Set();
  for (const e of evidence.files) {
    assert.ok(
      e.path.startsWith('reports/') && !e.path.split('/').some((p) => p === '..' || p === '.'),
      'Escaping report',
    );
    assert.ok(!seen.has(e.path));
    seen.add(e.path);
    const p = path.join(directory, e.path);
    safeChild(directory, p);
    assert.ok(lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink());
    assert.equal(lstatSync(p).size, e.bytes);
    assert.equal(checksum(p), e.digest, 'Damaged backend report');
  }
  assert.deepEqual(
    files(path.join(directory, 'reports'))
      .map((p) => path.relative(directory, p).split(path.sep).join('/'))
      .sort(),
    [...seen].sort(),
    'Report inventory differs',
  );
  const summary = validateBackendReports(root, {
    reportsDirectory: path.join(directory, backendCollectedPath('surefire')),
  });
  assert.deepEqual(summary, evidence.summary);
  assert.deepEqual(read(path.join(directory, 'backend-tests.json')), summary);
  const checkstyle = readFileSync(path.join(directory, backendCollectedPath('checkstyle')), 'utf8'),
    spotbugs = readFileSync(path.join(directory, backendCollectedPath('spotbugs')), 'utf8'),
    jacoco = readFileSync(path.join(directory, backendCollectedPath('jacoco'), 'jacoco.xml'), 'utf8');
  assert.match(checkstyle, /<checkstyle\b/);
  assert.ok(!/<error\b/.test(checkstyle), 'Checkstyle violation');
  assert.match(spotbugs, /<BugCollection\b/);
  assert.ok(!/<(?:BugInstance|Error)\b/.test(spotbugs), 'SpotBugs violation');
  assert.match(jacoco, /<report\b/);
  assert.match(jacoco, /<class\b/);
  assert.match(jacoco, /<counter type="(?:INSTRUCTION|LINE)"/);
  assert.ok(lstatSync(path.join(directory, backendCollectedPath('execution'))).size > 0);
  assert.ok(
    existsSync(path.join(directory, backendCollectedPath('jacoco'), 'index.html')) &&
      existsSync(path.join(directory, backendCollectedPath('jacoco'), 'jacoco.csv')),
    'Incomplete coverage reports',
  );
  return summary;
}
export async function prepareBackendReuse(
  directory,
  original,
  env = process.env,
  { download = fetch, run = command } = {},
) {
  validateBackendProof(original.environmentProof);
  validateBackendEvidence(directory, original.backendEvidence);
  const deps = read(path.join(directory, 'maven-dependencies.json'));
  validateMavenEntries(deps);
  assert.equal(hash(JSON.stringify(deps)), original.environmentProof.dependencies);
  const repo = path.join(os.homedir(), '.m2/repository');
  await materializeMaven(deps, repo, download);
  for (const i of original.environmentProof.images) {
    run('docker', ['pull', i.reference]);
    const actual = JSON.parse(run('docker', ['image', 'inspect', i.reference]))[0];
    assert.deepEqual(
      { reference: i.reference, id: actual.Id, repoDigests: [...actual.RepoDigests].sort() },
      i,
      'Test database image changed',
    );
  }
  for (const e of deps) assert.equal(checksum(path.join(repo, e.path)), e.digest);
  const proof = {
    ...backendRuntime(env),
    dependencies: hash(JSON.stringify(deps)),
    images: imageInventory(process.cwd()),
  };
  validateBackendProof(proof);
  return proof;
}
export function currentBackendProof(directory, env = process.env) {
  const deps = read(path.join(directory, 'maven-dependencies.json'));
  validateMavenEntries(deps);
  for (const e of deps) assert.equal(checksum(path.join(os.homedir(), '.m2/repository', e.path)), e.digest);
  return { ...backendRuntime(env), dependencies: hash(JSON.stringify(deps)), images: imageInventory(process.cwd()) };
}

export async function materializeMaven(deps, repo, download = fetch) {
  validateMavenEntries(deps);
  // Only exact source artifacts from Maven Central, with original content hashes; no credentials/settings copied.
  for (let offset = 0; offset < deps.length; offset += 8)
    await Promise.all(
      deps.slice(offset, offset + 8).map(async (e) => {
        const p = path.join(repo, e.path);
        safeChild(repo, p);
        if (checksum(p) === e.digest) return;
        assert.ok(!existsSync(p), 'Existing Maven artifact differs');
        const response = await download('https://repo.maven.apache.org/maven2/' + e.path, {
          signal: AbortSignal.timeout(30000),
        });
        assert.equal(response.ok, true, 'Maven dependency unavailable');
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, e.bytes);
        assert.equal(hash(bytes), e.digest, 'Maven content differs');
        mkdirSync(path.dirname(p), { recursive: true });
        assert.equal(
          realpathSync(path.dirname(p)).startsWith(realpathSync(repo) + path.sep),
          true,
          'Linked Maven cache',
        );
        writeFileSync(p, bytes, { flag: 'wx' });
      }),
    );
}

function safeChild(root, file) {
  const relative = path.relative(root, file);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Escaping artifact');
  let p = path.resolve(root);
  assert.ok(!existsSync(p) || !lstatSync(p).isSymbolicLink(), 'Linked artifact root');
  for (const part of relative.split(path.sep)) {
    p = path.join(p, part);
    assert.ok(!existsSync(p) || !lstatSync(p).isSymbolicLink(), 'Linked artifact path');
  }
}

// Testcontainers persists its discovered Unix socket strategy on first connection.
// Only that exact known provider is equivalent to the clean Linux runner default;
// timestamps/comments are not runtime inputs. Every other key/provider remains unsupported.
export function testcontainersConfiguration(file) {
  const strategy = 'org.testcontainers.dockerclient.UnixSocketClientProviderStrategy';
  if (!existsSync(file)) return { strategy };
  assert.ok(!lstatSync(file).isSymbolicLink(), 'Linked Testcontainers configuration');
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.startsWith('!'));
  assert.deepEqual(lines, ['docker.client.strategy=' + strategy], 'External Testcontainers configuration');
  return { strategy };
}
