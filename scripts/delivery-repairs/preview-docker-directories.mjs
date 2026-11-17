import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { nativeDockerVnodeSource } from './preview-docker-vnode-source.mjs';
import { referenceHash } from './preview-reference-history.mjs';
import { observedHostMountPath } from './preview-reference-proof-core.mjs';

export function parseDockerVnodeInventory(raw) {
  const files = [];
  let pid, file;
  for (const part of raw.split('\0')) {
    const field = part.replace(/^\n/, '');
    if (!field) continue;
    const key = field[0],
      value = field.slice(1);
    if (key === 'p') {
      pid = Number(value);
      file = null;
    } else if (key === 'f') {
      file = { pid, descriptor: value };
      files.push(file);
    } else if (file && ['a', 'D', 'i', 't', 'n'].includes(key)) {
      assert.equal(file[key], undefined, 'Duplicate vnode inventory field');
      file[key] = value;
    }
  }
  return files;
}

// No observation/exec adapters: the public producer invokes real local tools.
// A returned directory remains referenced and must never authorize cleanup.
export function collectRetainedDockerDirectories(identity, inventory, record) {
  const matching = inventory.files.filter(
    (f) => f.name === identity.worktree || f.name.startsWith(identity.worktree + path.sep),
  );
  if (!matching.length) return null;
  assert.equal(process.platform, 'darwin', 'Retained Docker directory proof requires native macOS identities');
  assert.ok(
    matching.every((f) => f.type === 'DIR' && /^\d+$/.test(f.descriptor)),
    'Non-directory task reference',
  );
  const file = record('docker-directory-start', { matching });
  const directory = path.dirname(file);
  const execute = (command, args) => {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
    record('docker-native-command', {
      command,
      args,
      status: r.status,
      signal: r.signal,
      error: r.error?.message,
      stdout: r.stdout,
      stderr: r.stderr,
    });
    assert.equal(r.status, 0, 'Native Docker identity command failed: ' + command);
    assert.equal(r.signal, null);
    return r.stdout;
  };
  const endpoint = identity.dockerEndpoint.slice('unix://'.length);
  assert.ok(path.isAbsolute(endpoint));
  const endpointReal = realpathSync(endpoint),
    endpointStat = lstatSync(endpointReal, { bigint: true });
  assert.ok(endpointStat.isSocket());
  const owners = [
    ...new Set(inventory.files.filter((f) => f.type === 'unix' && f.name === endpoint).map((f) => f.pid)),
  ];
  assert.equal(owners.length, 1, 'Unique actual local Docker endpoint owner required');
  const backendPid = owners[0];
  const pids = [...new Set([backendPid, ...matching.map((f) => f.pid)])].sort((a, b) => a - b);
  const sdkPath = execute('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']).trim();
  assert.ok(path.isAbsolute(sdkPath));
  const sdk = realpathSync(sdkPath);
  const source = path.join(directory, 'vnode-probe.c');
  writeFileSync(source, nativeDockerVnodeSource, { flag: 'wx', mode: 0o600 });
  const binary = path.join(directory, 'vnode-probe');
  execute('/usr/bin/clang', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk, source, '-o', binary]);
  const details = parseDockerVnodeInventory(
    execute('/usr/sbin/lsof', ['-nP', '-a', '-p', pids.join(','), '-F0pfaDint']),
  );
  const rootStat = lstatSync(identity.worktree, { bigint: true });
  assert.ok(
    rootStat.isDirectory() && !rootStat.isSymbolicLink() && realpathSync(identity.worktree) === identity.worktree,
  );
  const sourceMounts = identity.backend.inventory.mounts.filter(
    (m) => m.Type === 'bind' && observedHostMountPath(m.Source, 'darwin') === identity.worktree,
  );
  assert.equal(sourceMounts.length, 1, 'One exact retained backend source mount required');
  assert.equal(sourceMounts[0].Destination, '/workspace');
  const services = [];
  for (const pid of pids) {
    const targets = matching.filter((f) => f.pid === pid).sort((a, b) => Number(a.descriptor) - Number(b.descriptor));
    // Endpoint owner must have an independently observed numeric directory FD.
    assert.ok(targets.length, 'Endpoint owner has no retained source directory');
    const kernel = JSON.parse(execute(binary, [String(pid), ...targets.map((f) => f.descriptor)]));
    const process = inventory.processes.find((p) => p.pid === pid);
    assert.ok(process && process.ppid === kernel.ppid && kernel.pid === pid && kernel.processStable);
    assert.equal(kernel.uid, Number(rootStat.uid));
    const name = pid === backendPid ? 'com.docker.backend' : 'com.docker.sailor';
    const identifier = pid === backendPid ? 'com.docker.docker' : 'com.docker';
    const executable = '/Applications/Docker.app/Contents/MacOS/' + name;
    assert.equal(kernel.executable, executable, 'Unknown directory holder executable');
    if (pid !== backendPid) assert.equal(kernel.ppid, backendPid, 'Directory holder is not Docker endpoint child');
    assert.equal(realpathSync(executable), executable);
    const before = lstatSync(executable, { bigint: true });
    assert.ok(before.isFile() && !before.isSymbolicLink() && (before.mode & 0o022n) === 0n);
    const images = details.filter((f) => f.pid === pid && f.descriptor === 'txt' && f.n === executable);
    assert.equal(images.length, 1, 'Actual loaded Docker image vnode required');
    assert.equal(BigInt(images[0].D), before.dev);
    assert.equal(BigInt(images[0].i), before.ino);
    execute('/usr/bin/codesign', [
      '--verify',
      '--strict',
      '-R',
      '=anchor apple generic and certificate leaf[subject.OU] = "9BNSXJN65R" and identifier "' + identifier + '"',
      executable,
    ]);
    const imageHash = referenceHash(readFileSync(executable));
    const after = lstatSync(executable, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode']) assert.equal(after[key], before[key]);
    assert.equal(kernel.fds.length, targets.length);
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index],
        fd = kernel.fds[index];
      assert.equal(fd.fd, Number(target.descriptor));
      assert.equal(fd.returnedSize, kernel.expectedSize);
      assert.equal(fd.errno, 0);
      assert.equal(fd.path, target.name, 'Kernel source directory mapping changed');
      assert.equal(String(fd.device), String(rootStat.dev));
      assert.equal(fd.directory, true);
      assert.equal(fd.vnodeType, 2);
      assert.equal(fd.fileType, 1);
      // Native SDK FREAD, optionally O_EVTONLY. Neither grants write access.
      assert.ok([1, 0x8001].includes(fd.openFlags), 'Directory handle is not exclusively read-only');
      assert.equal(fd.guardFlags, 0);
      const observed = details.filter((f) => f.pid === pid && f.descriptor === target.descriptor);
      assert.equal(observed.length, 1);
      assert.equal(observed[0].t, 'DIR');
      assert.equal(observed[0].a, 'r');
      assert.equal(observed[0].n, fd.path);
      assert.equal(BigInt(observed[0].D), BigInt(fd.device));
      assert.equal(BigInt(observed[0].i), BigInt(fd.inode));
      if (fd.fsgetpathErrno === 0) {
        assert.equal(fd.lstatStatus, 0);
        assert.equal(fd.pathDevice, fd.device);
        assert.equal(fd.pathInode, fd.inode);
        assert.equal(fd.pathMode, fd.mode);
        assert.equal(fd.fsgetpathErrno, 0);
        assert.equal(fd.fsgetpath, fd.path);
        assert.equal(realpathSync(fd.path), fd.path);
      } else {
        // This is a real open DIR vnode, not absence evidence. Its kernel path
        // maps to the preserved source; missing namespace entries remain missing.
        assert.equal(fd.fsgetpathSize, -1);
        assert.equal(fd.fsgetpathErrno, 2);
        assert.equal(fd.fsgetpath, '');
        if (fd.lstatStatus === 0) {
          assert.equal(fd.lstatErrno, 0);
          assert.notEqual(fd.pathInode, fd.inode, 'Ambiguous existing vnode namespace');
          assert.equal(fd.pathDevice, fd.device);
          assert.equal(fd.pathMode & 0o170000, 0o040000);
          assert.equal(realpathSync(fd.path), fd.path);
          const current = lstatSync(fd.path, { bigint: true });
          assert.equal(String(current.ino), String(fd.pathInode));
        } else {
          assert.equal(fd.lstatStatus, -1);
          assert.equal(fd.lstatErrno, 2);
        }
        assert.equal(fd.parent, path.dirname(fd.path));
        assert.ok(fd.parent === identity.worktree || fd.parent.startsWith(identity.worktree + path.sep));
        assert.equal(fd.parentStatus, 0);
        assert.equal(fd.parentDevice, fd.device);
        assert.equal(fd.parentMode & 0o170000, 0o040000);
        assert.equal(realpathSync(fd.parent), fd.parent);
        const parent = lstatSync(fd.parent, { bigint: true });
        assert.equal(String(parent.ino), String(fd.parentInode));
      }
    }
    services.push({
      ...kernel,
      image: {
        executable,
        identifier,
        team: '9BNSXJN65R',
        hash: imageHash,
        device: String(before.dev),
        inode: String(before.ino),
        signatureVerified: true,
      },
    });
  }
  const proof = {
    kind: 'retained-docker-source-directories-v1',
    backend: identity.backend.id,
    sourceMount: sourceMounts[0],
    sourceDevice: String(rootStat.dev),
    sourceInode: String(rootStat.ino),
    sourceUid: Number(rootStat.uid),
    endpoint: {
      path: endpoint,
      real: endpointReal,
      device: String(endpointStat.dev),
      inode: String(endpointStat.ino),
      ownerPid: backendPid,
    },
    services,
    cleanupAuthorized: false,
  };
  record('retained-directory-bindings', proof);
  return proof;
}
