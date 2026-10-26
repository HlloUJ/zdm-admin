import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
const digest = (data) => createHash('sha256').update(data).digest('hex');
const command = (program, args) => execFileSync(program, args, { encoding: 'utf8', timeout: 60000 }).trim();
function tree(root) {
  const hash = createHash('sha256');
  function visit(file) {
    const stat = lstatSync(file);
    hash.update(JSON.stringify([file, stat.mode]));
    if (stat.isSymbolicLink()) hash.update(readlinkSync(file));
    else if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(`${file}/${name}`);
    else {
      assert.ok(stat.isFile());
      hash.update(readFileSync(file));
    }
  }
  visit(root);
  return hash.digest('hex');
}
export function inventory() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  assert.match(process.version, /^v22\./);
  const release = readFileSync('/etc/os-release', 'utf8');
  assert.match(release, /^ID=ubuntu$/m);
  assert.match(release, /^VERSION_ID="24\.04"$/m);
  const chrome = command('/opt/google/chrome/chrome', ['--version']);
  assert.match(chrome, /^Google Chrome \d+\.\d+\.\d+\.\d+/);
  return {
    os: 'ubuntu-24.04',
    platform: 'linux/amd64',
    node: process.version,
    nodeSha256: digest(readFileSync(process.execPath)),
    chrome,
    chromePackage: command('dpkg-query', ['-W', '-f=${Status}|${Version}', 'google-chrome-stable']),
    playwright: JSON.parse(readFileSync('/opt/zdm-tools/node_modules/playwright/package.json')).version,
    packages: digest(command('dpkg-query', ['-W', '-f=${Package}=${Version}\n'])),
    osRelease: digest(release),
    fonts: tree('/usr/share/fonts'),
    fontConfig: tree('/etc/fonts'),
    browser: tree('/opt/google/chrome'),
  };
}
const file = '/opt/zdm-tools/origin.json';
if (process.argv[2] === 'write') {
  assert.match(process.env.SOURCE_REVISION ?? '', /^[a-f0-9]{40}$/);
  assert.match(process.env.SOURCE_RUN ?? '', /^https:\/\/github.com\/HlloUJ\/zdm-admin\/actions\/runs\/\d+$/);
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        sourceRevision: process.env.SOURCE_REVISION,
        sourceRun: process.env.SOURCE_RUN,
        ubuntuBase: 'ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac',
        nodeBase: 'node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d',
        inventory: inventory(),
      },
      null,
      2,
    ) + '\n',
  );
} else if (process.argv[2] === 'verify') {
  const origin = JSON.parse(readFileSync(file));
  assert.deepEqual(inventory(), origin.inventory, 'Prebuilt toolchain changed; refresh image independently');
  console.log(JSON.stringify(origin));
}
