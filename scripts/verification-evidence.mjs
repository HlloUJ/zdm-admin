import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EVIDENCE_VERSION = 2;
const contentCache = new Map();
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const jsonDigest = (value) => digest(JSON.stringify(value));

function capture(root, command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} identity unavailable`);
  return result.stdout.trim();
}

function fileDigest(file) {
  const stat = lstatSync(file, { bigint: true });
  const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const cached = contentCache.get(file);
  if (cached?.key === key) return cached.digest;
  const value = digest(readFileSync(file));
  contentCache.set(file, { key, digest: value });
  return value;
}

export function hashPaths(root, paths, { dependency = false } = {}) {
  const hash = createHash('sha256');
  const seen = new Set();
  function visit(relative, absolute) {
    hash.update(JSON.stringify(relative));
    if (!existsSync(absolute)) {
      hash.update('missing');
      return;
    }
    const stat = lstatSync(absolute);
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) {
      hash.update(`link:${readlinkSync(absolute)}`);
      const resolved = realpathSync(absolute);
      if (seen.has(resolved)) throw new Error(`Cyclic input link: ${relative}`);
      seen.add(resolved);
      visit(relative, resolved);
      seen.delete(resolved);
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (dependency && ['.cache', '.vite', '.vite-temp'].includes(name)) continue;
        visit(`${relative}/${name}`, path.join(absolute, name));
      }
    } else if (stat.isFile()) hash.update(fileDigest(absolute));
    else throw new Error(`Unsupported input: ${relative}`);
  }
  for (const relative of [...new Set(paths)].sort()) visit(relative, path.resolve(root, relative));
  return hash.digest('hex');
}

function sourceFiles(root) {
  const files = capture(root, 'git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter((file) => file && !file.startsWith('.task-verification/'));
  for (const directory of ['', 'backend']) {
    const absolute = path.join(root, directory);
    if (existsSync(absolute)) {
      for (const file of readdirSync(absolute)) {
        if (file.startsWith('.env') || file === '.npmrc') files.push(path.join(directory, file));
      }
    }
  }
  return [...new Set(files)].sort();
}

function sourceSnapshot(root, files) {
  let baseline;
  let mergeBase;
  try {
    baseline = capture(root, 'git', ['rev-parse', '--verify', 'refs/remotes/origin/main']);
  } catch {
    baseline = capture(root, 'git', ['rev-parse', '--verify', 'refs/heads/main']);
  }
  mergeBase = capture(root, 'git', ['merge-base', 'HEAD', baseline]);
  return {
    digest: hashPaths(root, files),
    mutationStamp: jsonDigest(
      [...new Set(files)].sort().map((file) => {
        try {
          const stat = lstatSync(path.resolve(root, file), { bigint: true });
          return [file, String(stat.ino), String(stat.mtimeNs), String(stat.ctimeNs)];
        } catch {
          return [file, 'missing'];
        }
      }),
    ),
    baseline,
    mergeBase,
    head: capture(root, 'git', ['rev-parse', 'HEAD']),
  };
}

export function captureSource(root) {
  return sourceSnapshot(root, sourceFiles(root));
}

const BACKEND_ENTRIES = [
  'scripts/verification-evidence.mjs',
  'scripts/verification-runner.mjs',
  'scripts/backend-test-evidence.mjs',
];

function backendInputScope(task) {
  if (!/npm(?:\.cmd)?$/.test(task.command) || task.args?.[0] !== 'run') return null;
  const scriptName = task.args[1];
  if (!['backend:test', 'backend:quality', 'backend:quality:static'].includes(scriptName)) return null;
  const packageFile = JSON.parse(readFileSync(path.join(task.root, 'package.json'), 'utf8'));
  const scripts = packageFile.scripts ?? {};
  const command = scripts[scriptName];
  const supported =
    typeof command === 'string' &&
    /^docker compose run --rm --no-deps backend-tools mvn -B(?: [\w:./=-]+)+$/.test(command);
  if (!supported || scripts[`pre${scriptName}`] || scripts[`post${scriptName}`]) return null;
  const allFiles = sourceFiles(task.root);
  const files = new Set(
    allFiles.filter(
      (file) =>
        file.startsWith('backend/') || file.startsWith('.mvn/') || ['.gitignore', '.npmrc', 'pom.xml'].includes(file),
    ),
  );
  files.add('pom.xml');
  files.add('.npmrc');
  const pending = [...BACKEND_ENTRIES];
  while (pending.length) {
    const file = pending.pop();
    if (files.has(file)) continue;
    files.add(file);
    const absolute = path.resolve(task.root, file);
    if (!existsSync(absolute)) continue;
    const code = readFileSync(absolute, 'utf8');
    for (const match of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      const imported = path.relative(task.root, path.resolve(path.dirname(absolute), match[1]));
      if (imported.startsWith('..')) throw new Error('Verification helper imports outside the project');
      pending.push(imported);
    }
  }
  const selectedFiles = [...files].sort();
  const source = sourceSnapshot(task.root, selectedFiles);
  const npmScripts = Object.fromEntries(
    [scriptName, `pre${scriptName}`, `post${scriptName}`].map((name) => [name, scripts[name] ?? null]),
  );
  source.digest = jsonDigest({ files: source.digest, npmScripts });
  return {
    source,
    scope: {
      name: 'backend-maven',
      files: selectedFiles,
      packageScripts: npmScripts,
      compose: 'backend-tools and its volumes/networks',
      limitations: [
        'Maven dependency proof still hashes the shared Maven cache conservatively, including other projects.',
      ],
    },
  };
}

export function backendContainerImages(root, files) {
  const images = new Set();
  for (const file of files.filter((name) => name.endsWith('.java'))) {
    if (!existsSync(path.join(root, file))) continue;
    const source = readFileSync(path.join(root, file), 'utf8');
    const constants = new Map(
      [...source.matchAll(/\bstatic\s+final\s+String\s+(\w+)\s*=\s*"([^"\n]+)"\s*;/g)].map((match) => [
        match[1],
        match[2],
      ]),
    );
    if (/\.withImagePullPolicy\s*\(/.test(source))
      throw new Error('Custom container image pull policy requires fresh execution');
    for (const match of source.matchAll(/new\s+[\w.]*Container(?:\s*<[^<>]*>)?\s*\(\s*([^\n;]+)/g)) {
      const argument = match[1];
      const literal = argument.match(/^"([^"\n]+)"\s*[,)]/)?.[1];
      const parsed = argument.match(/^(?:DockerImageName\.)?parse\(\s*"([^"\n]+)"\s*\)/)?.[1];
      const variable = argument.match(/^(\w+)\s*[,)]/)?.[1];
      const image = literal ?? parsed ?? constants.get(variable);
      if (!image || !/^[\w][\w./:@-]+$/.test(image))
        throw new Error(`Dynamic container image cannot be proven: ${file}`);
      images.add(image);
    }
  }
  return [...images].sort();
}

function selectedCompose(config, root) {
  const service = config.services?.['backend-tools'];
  if (
    !service?.image ||
    service.build ||
    service.configs ||
    service.secrets ||
    service.entrypoint ||
    service.working_dir !== '/workspace/backend'
  )
    throw new Error('Unsupported backend-tools image/build/configuration');
  const volumes = {};
  for (const volume of service.volumes ?? []) {
    if (!['/workspace', '/root/.m2', '/var/run/docker.sock'].includes(volume.target))
      throw new Error('Unproven external backend volume');
    if (
      volume.target === '/workspace' &&
      (volume.type !== 'bind' || realpathSync(volume.source) !== realpathSync(root))
    )
      throw new Error('Backend workspace mount does not match the candidate');
    if (volume.type === 'volume') volumes[volume.source] = config.volumes?.[volume.source] ?? null;
  }
  const networks = Object.fromEntries(
    Object.keys(service.networks ?? {}).map((name) => [name, config.networks?.[name] ?? null]),
  );
  return { name: config.name, services: { 'backend-tools': service }, volumes, networks };
}

function dockerEnvironment(root, env, files, run = capture) {
  const pom = readFileSync(path.join(root, 'backend/pom.xml'), 'utf8');
  const dependencyConfiguration = [
    ...pom.matchAll(
      /<(?:parent|dependencies|dependencyManagement|plugins|pluginManagement|properties)>[\s\S]*?<\/(?:parent|dependencies|dependencyManagement|plugins|pluginManagement|properties)>/g,
    ),
  ]
    .map((match) => match[0])
    .join('\n');
  if (/SNAPSHOT|<version>\s*(?:LATEST|RELEASE|[[(])/i.test(dependencyConfiguration))
    throw new Error('Mutable Maven versions cannot reuse evidence');
  const compose = run(root, 'docker', ['compose', '--profile', 'tools', 'config', '--format', 'json'], env);
  const config = selectedCompose(JSON.parse(compose), root);
  const settings = { ...env, ...(config.services['backend-tools'].environment ?? {}) };
  if (Object.keys(settings).some((name) => /^TESTCONTAINERS_.*(?:IMAGE|SUBSTITUTOR)/.test(name)))
    throw new Error('Custom Testcontainers image substitution requires fresh execution');
  for (const file of files.filter((name) => name.endsWith('.properties'))) {
    if (
      existsSync(path.join(root, file)) &&
      /^\s*(?:[\w.]*\.image|image\.substitutor|hub\.image\.name\.prefix)\s*[=:]/m.test(
        readFileSync(path.join(root, file), 'utf8'),
      )
    )
      throw new Error('Custom Testcontainers image properties require fresh execution');
  }
  const references = [
    ...new Set([config.services['backend-tools'].image, ...backendContainerImages(root, files)]),
  ].sort();
  const images = references.map((reference) => ({
    reference,
    id: run(root, 'docker', ['image', 'inspect', '--format', '{{.Id}}', reference], env),
  }));
  // Testcontainers may start its helper images. Keep that small infrastructure domain conservative.
  const helpers = run(
    root,
    'docker',
    [
      'image',
      'ls',
      '--no-trunc',
      '--filter=reference=testcontainers/*',
      '--filter=reference=alpine:*',
      '--format',
      '{{.Repository}}:{{.Tag}} {{.ID}}',
    ],
    env,
  )
    .split('\n')
    .filter(Boolean)
    .sort();
  const versions = run(root, 'docker', ['version', '--format', '{{json .}}'], env);
  const composeVersion = run(root, 'docker', ['compose', 'version', '--short'], env);
  // A read-only probe of the same Maven volume used by the test command. It creates no service or database.
  const dependencies = run(
    root,
    'docker',
    [
      'compose',
      'run',
      '--rm',
      '--no-deps',
      'backend-tools',
      'sh',
      '-c',
      'set -eu; test -d /root/.m2/repository; if find /root/.m2 -iname "*SNAPSHOT*" -print -quit | grep -q .; then exit 8; fi; find /root/.m2 -type f \\( -name "*.jar" -o -name "*.pom" -o -name "*.xml" \\) -print0 | sort -z | xargs -0 -r sha256sum | sha256sum',
    ],
    env,
  );
  if (!/^[a-f0-9]{64}\s/.test(dependencies)) throw new Error('Maven dependency fingerprint unavailable');
  return {
    compose: jsonDigest(config),
    images,
    helpers,
    versions,
    composeVersion,
    dependencies,
    dependencyScope: 'shared-maven-cache-conservative',
  };
}

export function captureIdentity(task, { captureCommand = capture } = {}) {
  const { root, command, args = [], kind = 'node', env = process.env } = task;
  const backendScope = kind === 'backend' ? backendInputScope(task) : null;
  const source = backendScope?.source ?? captureSource(root);
  const eligible = task.reuse !== false && !['browser', 'runtime'].includes(kind);
  const environment = {
    node: process.version,
    executable: fileDigest(process.execPath),
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    env: jsonDigest(
      Object.fromEntries(
        Object.entries(env)
          // Shell depth / last executable describe the caller, not these project checks.
          .filter(
            ([name]) => !['SHLVL', '_', 'npm_lifecycle_event', 'npm_lifecycle_script', 'npm_command'].includes(name),
          )
          .sort(),
      ),
    ),
  };
  let reusable = eligible;
  let reason = eligible ? null : 'Always execute this check; skip expensive cache probes';
  if (eligible) {
    if (kind !== 'backend') environment.dependencies = hashPaths(root, ['node_modules'], { dependency: true });
    const executable = command.includes(path.sep)
      ? path.resolve(root, command)
      : (env.PATH ?? '')
          .split(path.delimiter)
          .map((dir) => path.join(dir, command))
          .find(existsSync);
    if (!executable) throw new Error('Command identity unavailable');
    const resolved = realpathSync(executable);
    environment.command = hashPaths(root, [resolved]);
    // npm loads code outside the project node_modules tree.
    if (/npm(?:\.cmd)?$/.test(command)) {
      environment.npm = hashPaths(root, [path.resolve(path.dirname(resolved), '..')], { dependency: true });
    }
    environment.npmConfig = hashPaths(root, [
      env.npm_config_userconfig ?? env.NPM_CONFIG_USERCONFIG ?? path.join(os.homedir(), '.npmrc'),
      env.npm_config_globalconfig ??
        env.NPM_CONFIG_GLOBALCONFIG ??
        path.resolve(path.dirname(process.execPath), '../etc/npmrc'),
    ]);
    if (env.NODE_OPTIONS || env.MAVEN_OPTS || env.MAVEN_ARGS) {
      reusable = false;
      reason = 'Custom runtime options require fresh execution';
    }
  }
  if (kind === 'backend' && eligible) {
    try {
      if (!backendScope)
        throw new Error('Backend command graph is not mapped; use full source scope and fresh execution');
      environment.docker = dockerEnvironment(root, env, backendScope.scope.files, captureCommand);
    } catch (error) {
      reusable = false;
      reason = error.message;
    }
  }
  const identity = {
    version: EVIDENCE_VERSION,
    root: realpathSync(root),
    source: { digest: source.digest, baseline: source.baseline, mergeBase: source.mergeBase },
    inputScope: backendScope?.scope ?? {
      name: 'full-candidate',
      files: ['tracked and nonignored untracked files', 'local env configuration'],
    },
    command,
    args,
    coverage: [...(task.coverage ?? [task.name])].sort(),
    kind,
    artifacts: artifactPaths(task),
    environment,
  };
  return { identity, fingerprint: jsonDigest(identity), source, reusable, reason };
}

function artifactPaths(task) {
  return task.kind === 'backend'
    ? [
        'backend/target/classes',
        'backend/target/test-classes',
        'backend/target/surefire-reports',
        'backend/target/jacoco.exec',
      ]
    : (task.artifacts ?? []);
}

export function captureArtifacts(task) {
  const paths = artifactPaths(task);
  return paths.length && paths.every((file) => existsSync(path.join(task.root, file)))
    ? hashPaths(task.root, paths)
    : null;
}

export function canReuse(record, snapshot, artifacts, root) {
  if (
    !snapshot.reusable ||
    record?.version !== EVIDENCE_VERSION ||
    record.status !== 'passed' ||
    record.exitCode !== 0 ||
    !record.completedAt ||
    !record.startedAt ||
    record.fingerprint !== snapshot.fingerprint ||
    record.artifacts !== artifacts
  )
    return false;
  if (snapshot.identity.artifacts.length && artifacts === null) return false;
  if (
    !Number.isFinite(Date.parse(record.startedAt)) ||
    !Number.isFinite(Date.parse(record.completedAt)) ||
    Date.parse(record.completedAt) < Date.parse(record.startedAt)
  )
    return false;
  if (jsonDigest(record.identity) !== record.fingerprint || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0)
    return false;
  try {
    const log = path.resolve(root, record.log);
    if (!log.startsWith(`${path.resolve(root, '.task-verification/logs')}${path.sep}`)) return false;
    return digest(readFileSync(log)) === record.logDigest;
  } catch {
    return false;
  }
}

export function evidenceMissReason(record, snapshot, artifacts) {
  if (!snapshot.reusable) return snapshot.reason ?? 'This check always runs';
  if (!record) return 'No completed evidence exists for this command and coverage';
  if (record.version !== EVIDENCE_VERSION) return 'Evidence schema or validation policy changed';
  if (record.status !== 'passed' || record.exitCode !== 0) return 'Previous execution did not produce reusable success';
  const old = record.identity;
  const next = snapshot.identity;
  if (old?.source?.baseline !== next.source.baseline || old?.source?.mergeBase !== next.source.mergeBase)
    return 'Candidate main baseline changed';
  if (old?.source?.digest !== next.source.digest) return `${next.inputScope.name} inputs or validation helpers changed`;
  if (old?.environment?.docker?.dependencies !== next.environment?.docker?.dependencies)
    return 'Maven dependency files changed (conservative shared-cache proof)';
  if (jsonDigest(old?.environment?.docker ?? null) !== jsonDigest(next.environment?.docker ?? null))
    return 'Backend compose configuration, relevant image or Docker toolchain changed';
  if (jsonDigest(old?.environment ?? null) !== jsonDigest(next.environment))
    return 'Command, dependency or execution environment changed';
  if (record.artifacts !== artifacts) return 'Required output artifacts changed or are missing';
  if (record.fingerprint !== snapshot.fingerprint) return 'Command, coverage or input scope changed';
  return 'Evidence or its complete log is missing, damaged or incomplete';
}
