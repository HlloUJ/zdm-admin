import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BASELINE_URL,
  MINIMUM_CHROME_VERSION,
  APT_NETWORK_CONFIG,
  compareVersions,
  parseBaseline,
  fetchBaseline,
  parseInstalledChrome,
  prepareBrowser,
  prepareDependencies,
  replaceSlowUbuntuMirror,
  configureAptNetwork,
} from './ci-chrome-preparation.mjs';

const latest = '156.0.8078.48';
const payload = (version = latest) => ({
  versions: [{ name: `chrome/platforms/linux/channels/stable/versions/${version}`, version }],
});
function fixture(before = latest) {
  let installed = before;
  const calls = [];
  const system = {
    fetch: async (url, options) => {
      assert.equal(url, BASELINE_URL);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      return { ok: true, json: async () => payload() };
    },
    inspect: () => installed,
    configureNetwork: () => calls.push('network'),
    run: (cmd, args, capture) => {
      calls.push([cmd, args, capture]);
      if (args.includes('install')) installed = latest;
      return capture ? 'All system dependencies are installed.' : '';
    },
    launch: async () => calls.push('launch'),
  };
  return {
    system,
    calls,
    setVersion: (value) => {
      installed = value;
    },
  };
}
test('version comparison is numeric and rejects incomplete or unsafe versions', () => {
  assert.equal(compareVersions('156.0.9.10', '156.0.9.9'), 1);
  assert.equal(compareVersions(latest, latest), 0);
  assert.equal(compareVersions(MINIMUM_CHROME_VERSION, latest), -1);
  for (const value of ['156', '156.1.2.3-beta', 'x', '', '99999999999999999.0.0.0'])
    assert.throws(() => compareVersions(value, latest));
});
test('only unambiguous official Linux Stable metadata above the delivered floor is accepted', () => {
  assert.equal(parseBaseline(payload()), latest);
  const invalid = [
    null,
    {},
    { versions: [] },
    { versions: [...payload().versions, ...payload().versions] },
    payload('155.0.8059.39'),
    payload('bad'),
  ];
  const wrongChannel = payload();
  wrongChannel.versions[0].name = wrongChannel.versions[0].name.replace('stable', 'beta');
  invalid.push(wrongChannel);
  for (const value of invalid) assert.throws(() => parseBaseline(value));
});
test('network and schema failures cannot silently reuse an installed older browser', async () => {
  await assert.rejects(
    fetchBaseline(async () => {
      throw new Error('timeout');
    }),
    /timeout/,
  );
  await assert.rejects(
    fetchBaseline(async () => ({ ok: false })),
    /unavailable/,
  );
  const f = fixture();
  f.system.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(prepareBrowser(f.system));
  assert.deepEqual(f.calls, []);
});
test('Stable package and actual binary must identify the same browser', () => {
  assert.equal(parseInstalledChrome(`Google Chrome ${latest}`, `install ok installed|${latest}-1`), latest);
  for (const pair of [
    [`Chromium ${latest}`, `install ok installed|${latest}-1`],
    [`Google Chrome ${latest}`, 'deinstall ok config-files|156.0.8078.48-1'],
    [`Google Chrome ${latest}`, 'install ok installed|155.0.8059.39-1'],
  ])
    assert.throws(() => parseInstalledChrome(...pair));
});
for (const version of [latest, '156.0.8078.49'])
  test(`qualified preinstalled Chrome ${version} is reused without apt or download`, async () => {
    const f = fixture(version);
    const result = await prepareBrowser(f.system);
    assert.equal(result.action, 'reused');
    assert.equal(result.after, version);
    assert.deepEqual(f.calls, []);
  });
for (const version of [null, '155.0.8059.39', MINIMUM_CHROME_VERSION])
  test(`missing or stale Chrome ${version} installs current Stable`, async () => {
    const f = fixture(version);
    const result = await prepareBrowser(f.system);
    assert.equal(result.action, 'installed');
    assert.equal(result.after, latest);
    assert.deepEqual(f.calls, ['network', ['npx', ['--no-install', 'playwright', 'install', 'chrome'], undefined]]);
  });
test('failed, ineffective or downgraded installation cannot become success', async () => {
  const f = fixture(MINIMUM_CHROME_VERSION);
  f.system.run = () => {
    throw new Error('install failed');
  };
  await assert.rejects(prepareBrowser(f.system), /install failed/);
  f.system.run = () => {};
  await assert.rejects(prepareBrowser(f.system), /baseline/);
  f.system.run = () => f.setVersion('155.0.8059.39');
  await assert.rejects(prepareBrowser(f.system), /baseline/);
});
test('complete dependency installation and public dry-run validation remain mandatory even for reused Chrome', async () => {
  const f = fixture();
  const browser = await prepareBrowser(f.system);
  const result = await prepareDependencies(f.system, browser);
  assert.equal(result.completeDependencies, true);
  assert.equal(result.launchVerified, true);
  assert.deepEqual(f.calls, [
    'network',
    ['npx', ['--no-install', 'playwright', 'install-deps', 'chrome'], undefined],
    ['npx', ['--no-install', 'playwright', 'install-deps', 'chrome', '--dry-run'], true],
    'launch',
  ]);
});
for (const mode of ['install', 'verify', 'unknown-output', 'changed-browser', 'launch'])
  test(`dependency ${mode} failure stops before tests or evidence reuse`, async () => {
    const f = fixture(),
      browser = await prepareBrowser(f.system),
      run = f.system.run;
    f.system.run = (cmd, args, capture) => {
      if ((mode === 'install' && !capture) || (mode === 'verify' && capture)) throw new Error(mode);
      if (mode === 'unknown-output' && capture) return 'not checked';
      if (mode === 'changed-browser' && capture) f.setVersion('156.0.8078.49');
      return run(cmd, args, capture);
    };
    if (mode === 'launch')
      f.system.launch = async () => {
        throw new Error('launch');
      };
    await assert.rejects(prepareDependencies(f.system, browser));
  });
test('APT source replacement is restricted to the observed Azure Ubuntu mirror', () => {
  const text =
    'URIs: mirror+file:/etc/apt/apt-mirrors.txt\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\nhttp://azure.archive.ubuntu.com/ubuntu/ priority:1\nhttps://packages.microsoft.com/ubuntu/24.04/prod\nhttp://azure.archive.ubuntu.com.evil/ubuntu\n';
  assert.equal(
    replaceSlowUbuntuMirror(text),
    text.replace('http://azure.archive.ubuntu.com/ubuntu/', 'https://archive.ubuntu.com/ubuntu/'),
  );
  assert.equal(replaceSlowUbuntuMirror(replaceSlowUbuntuMirror(text)), replaceSlowUbuntuMirror(text));
  assert.doesNotMatch(APT_NETWORK_CONFIG, /AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host/);
  assert.match(APT_NETWORK_CONFIG, /Error-Mode "any"/);
});
test('legacy sources, deb822 and mirrorlist are handled idempotently without modifying vendor repositories or signature settings', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-apt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'sources.list.d'));
  mkdirSync(path.join(root, 'apt.conf.d'));
  const original =
    'URIs: http://azure.archive.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
  writeFileSync(path.join(root, 'sources.list.d/ubuntu.sources'), original);
  writeFileSync(
    path.join(root, 'apt-mirrors.txt'),
    'http://azure.archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu priority:2\n',
  );
  writeFileSync(path.join(root, 'sources.list'), 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n');
  writeFileSync(
    path.join(root, 'sources.list.d/vendor.list'),
    'deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n',
  );
  assert.equal(configureAptNetwork(root).length, 3);
  assert.deepEqual(configureAptNetwork(root), []);
  assert.equal(
    readFileSync(path.join(root, 'sources.list.d/ubuntu.sources'), 'utf8'),
    replaceSlowUbuntuMirror(original),
  );
  assert.match(readFileSync(path.join(root, 'sources.list.d/vendor.list'), 'utf8'), /packages.microsoft.com/);
  assert.equal(readFileSync(path.join(root, 'apt.conf.d/99zdm-ci-network'), 'utf8'), APT_NETWORK_CONFIG);
  writeFileSync(path.join(root, 'apt.conf.d/99zdm-ci-network'), 'foreign');
  assert.throws(() => configureAptNetwork(root), /Foreign/);
});
test('APT preparation rejects symlink sources rather than writing to an unrelated target', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zdm-apt-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'apt.conf.d'));
  writeFileSync(path.join(root, 'target'), 'http://azure.archive.ubuntu.com/ubuntu');
  symlinkSync(path.join(root, 'target'), path.join(root, 'sources.list'));
  assert.throws(() => configureAptNetwork(root), /Unsafe/);
  assert.equal(readFileSync(path.join(root, 'target'), 'utf8'), 'http://azure.archive.ubuntu.com/ubuntu');
});
test('both workflow shards prepare browser and all dependencies before equivalence and retain existing commands and workers', () => {
  // The scope preflight runs before npm ci, so these diagnostics use Node builtins only.
  const workflow = readFileSync(new URL('../.github/workflows/quality.yml', import.meta.url), 'utf8');
  const sections = Object.fromEntries(
    [...workflow.matchAll(/^ {2}([a-z0-9_]+):\n([\s\S]*?)(?=^ {2}[a-z0-9_]+:|$(?![\s\S]))/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  assert.deepEqual(
    Object.keys(sections).filter((x) => x.startsWith('frontend_e2e')),
    ['frontend_e2e_1', 'frontend_e2e_2'],
  );
  for (const [index, job] of [sections.frontend_e2e_1, sections.frontend_e2e_2].entries()) {
    const commands = [...job.matchAll(/^ {6}- (?:run:|id:) (.+)$/gm)].map((match) => match[1]);
    const browser = commands.findIndex((x) => x.includes('run chrome-browser --')),
      dependencies = commands.findIndex((x) => x.includes('run chrome-dependencies --')),
      equivalence = commands.indexOf('equivalent');
    assert.ok(browser > 0 && dependencies === browser + 1 && equivalence === dependencies + 1);
    assert.match(commands[browser], /ci-chrome-preparation\.mjs browser$/);
    assert.match(commands[dependencies], /ci-chrome-preparation\.mjs dependencies$/);
    assert.ok(job.includes(`--shard=${index + 1}/2 --workers=1 --reporter=list,json`));
    assert.match(job, /- if: steps\.equivalent\.outputs\.reused != 'true'\n {8}run: .*run e2e-/);
    assert.match(job, /PLAYWRIGHT_CHANNEL: chrome/);
  }
  assert.match(sections.frontend, /name: Frontend quality/);
  assert.match(sections.backend, /name: Backend quality/);
  assert.match(sections.scope, /npm run test:ci-reuse/);
});
test('prebuilt dependency verification retains complete dry-run and launch without installing or configuring apt', async () => {
  const f = fixture();
  f.system.prebuilt = true;
  const browser = await prepareBrowser(f.system);
  const result = await prepareDependencies(f.system, browser);
  assert.equal(result.action, 'verified-prebuilt');
  assert.deepEqual(f.calls, [
    ['npx', ['--no-install', 'playwright', 'install-deps', 'chrome', '--dry-run'], true],
    'launch',
  ]);
});
test('stale prebuilt Chrome fails without downloads or environment mutation', async () => {
  const f = fixture(MINIMUM_CHROME_VERSION);
  f.system.prebuilt = true;
  await assert.rejects(prepareBrowser(f.system), /update the independent image/);
  assert.deepEqual(f.calls, []);
});
