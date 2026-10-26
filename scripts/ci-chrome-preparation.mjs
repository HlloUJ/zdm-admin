// CI-only preparation. Browser reuse never substitutes for runtime fingerprint validation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MINIMUM_CHROME_VERSION = '156.0.8078.47'; // Last delivered Linux Chrome; never downgrade it.
export const BASELINE_URL =
  'https://versionhistory.googleapis.com/v1/chrome/platforms/linux/channels/stable/versions?order_by=version%20desc&page_size=1';
export const APT_NETWORK_CONFIG =
  'Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "1";\nAPT::Update::Error-Mode "any";\n';
const CHROME = '/opt/google/chrome/chrome';
const dependencyArgs = ['--no-install', 'playwright', 'install-deps', 'chrome'];
export function compareVersions(left, right) {
  for (const version of [left, right]) assert.match(version ?? '', /^\d+\.\d+\.\d+\.\d+$/);
  const a = left.split('.').map(Number),
    b = right.split('.').map(Number);
  assert.ok([...a, ...b].every(Number.isSafeInteger));
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}
export function parseBaseline(payload) {
  assert.equal(payload?.versions?.length, 1, 'Ambiguous Chrome Stable baseline');
  const item = payload.versions[0];
  assert.equal(item.name, `chrome/platforms/linux/channels/stable/versions/${item.version}`);
  assert.ok(compareVersions(item.version, MINIMUM_CHROME_VERSION) >= 0, 'Stale Chrome baseline');
  return item.version;
}
export async function fetchBaseline(fetcher = fetch) {
  const response = await fetcher(BASELINE_URL, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  assert.equal(response.ok, true, 'Official Chrome baseline unavailable; do not accept stale evidence');
  return parseBaseline(await response.json());
}
export function parseInstalledChrome(binary, pkg) {
  const version = /^Google Chrome (\d+\.\d+\.\d+\.\d+)(?:\s.*)?$/.exec(binary.trim())?.[1];
  const packageVersion = /^install ok installed\|(\d+\.\d+\.\d+\.\d+)-[^\s]+$/.exec(pkg.trim())?.[1];
  assert.ok(version && packageVersion, 'Chrome Stable binary/package identity unavailable');
  assert.equal(version, packageVersion, 'Chrome binary/package version mismatch');
  return version;
}
export async function prepareBrowser(system) {
  const baseline = await fetchBaseline(system.fetch);
  const before = system.inspect();
  const reused = before !== null && compareVersions(before, baseline) >= 0;
  if (!reused) {
    system.configureNetwork();
    system.run('npx', ['--no-install', 'playwright', 'install', 'chrome']);
  }
  const after = system.inspect();
  assert.ok(after && compareVersions(after, baseline) >= 0, 'Installed Chrome does not meet current Stable baseline');
  if (before) assert.ok(compareVersions(after, before) >= 0, 'Chrome downgrade prohibited');
  if (reused) assert.equal(after, before, 'Reused browser changed during preparation');
  return {
    version: 1,
    baselineSource: BASELINE_URL,
    minimumVersion: MINIMUM_CHROME_VERSION,
    baseline,
    before,
    after,
    action: reused ? 'reused' : 'installed',
  };
}
export function replaceSlowUbuntuMirror(source) {
  return source.replace(
    /https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=[\s/]|$)/g,
    'https://archive.ubuntu.com/ubuntu',
  );
}
export function configureAptNetwork(root = '/etc/apt') {
  const directory = path.join(root, 'sources.list.d');
  const files = [
    path.join(root, 'sources.list'),
    path.join(root, 'apt-mirrors.txt'),
    ...(existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => /\.(?:list|sources)$/.test(name))
          .map((name) => path.join(directory, name))
      : []),
  ];
  const changed = [];
  for (const file of files.filter(existsSync)) {
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Unsafe APT source file');
    const original = readFileSync(file, 'utf8'),
      updated = replaceSlowUbuntuMirror(original);
    if (updated !== original) {
      writeFileSync(file, updated);
      changed.push(path.basename(file));
    }
  }
  const config = path.join(root, 'apt.conf.d/99zdm-ci-network');
  if (existsSync(config)) {
    assert.ok(lstatSync(config).isFile() && !lstatSync(config).isSymbolicLink(), 'Unsafe APT network configuration');
    assert.equal(readFileSync(config, 'utf8'), APT_NETWORK_CONFIG, 'Foreign APT configuration; do not overwrite');
  } else writeFileSync(config, APT_NETWORK_CONFIG, { flag: 'wx', mode: 0o644 });
  return changed;
}
export async function prepareDependencies(system, browser) {
  assert.equal(browser?.version, 1);
  assert.equal(browser.baselineSource, BASELINE_URL);
  assert.ok(compareVersions(browser.baseline, MINIMUM_CHROME_VERSION) >= 0);
  assert.ok(compareVersions(browser.after, browser.baseline) >= 0);
  system.configureNetwork();
  // Same complete dependency group as the former `install --with-deps chrome`.
  system.run('npx', dependencyArgs);
  const verification = system.run('npx', [...dependencyArgs, '--dry-run'], true);
  assert.ok(
    verification.split('\n').some((line) => line.trim() === 'All system dependencies are installed.'),
    'Playwright did not confirm the complete dependency inventory',
  );
  assert.equal(system.inspect(), browser.after, 'Browser changed during dependency preparation');
  await system.launch();
  return { version: 1, browserVersion: browser.after, completeDependencies: true, launchVerified: true };
}
function run(program, args, capture = false) {
  const result = spawnSync(program, args, {
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${program} ${args.join(' ')} failed; preserve the first failure`);
  return result.stdout?.trim() ?? '';
}
function assertCiHost() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Preparation is restricted to CI');
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const release = readFileSync('/etc/os-release', 'utf8');
  assert.match(release, /^ID=ubuntu$/m);
  assert.match(release, /^VERSION_ID="24\.04"$/m);
}
export async function main(args) {
  assertCiHost();
  assert.equal(args.length, 1);
  if (args[0] === 'configure-network') {
    assert.equal(process.getuid(), 0);
    console.log(JSON.stringify({ changed: configureAptNetwork() }));
    return;
  }
  assert.ok(['browser', 'dependencies'].includes(args[0]));
  assert.ok(process.env.CI_EVIDENCE_DIR, 'Missing CI evidence destination');
  const system = {
    fetch,
    inspect: () =>
      existsSync(CHROME)
        ? parseInstalledChrome(
            run(CHROME, ['--version'], true),
            run('dpkg-query', ['-W', '-f=${Status}|${Version}', 'google-chrome-stable'], true),
          )
        : null,
    configureNetwork: () =>
      run('sudo', [
        '-n',
        '--preserve-env=GITHUB_ACTIONS',
        process.execPath,
        fileURLToPath(import.meta.url),
        'configure-network',
      ]),
    run,
    launch: async () => {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch({ channel: 'chrome' });
      await browser.close();
    },
  };
  const browserFile = path.join(process.env.CI_EVIDENCE_DIR, 'chrome-browser.json');
  const result =
    args[0] === 'browser'
      ? await prepareBrowser(system)
      : await prepareDependencies(system, JSON.parse(readFileSync(browserFile, 'utf8')));
  writeFileSync(
    args[0] === 'browser' ? browserFile : path.join(process.env.CI_EVIDENCE_DIR, 'chrome-dependencies.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
