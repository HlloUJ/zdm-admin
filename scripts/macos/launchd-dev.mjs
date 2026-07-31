import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const docker = '/usr/local/bin/docker';
const open = '/usr/bin/open';
const npm = 'npm';

function run(command, args) {
  return spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' }).status === 0;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const closed = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', closed);
    socket.once('timeout', closed);
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await wait(1_000);
  }
  return false;
}

async function ensureDocker() {
  if (run(docker, ['info', '--format', '{{.ServerVersion}}'])) return true;

  console.log('Docker is not ready. Starting Docker Desktop...');
  run(open, ['-gja', 'Docker']);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await wait(2_000);
    if (run(docker, ['info', '--format', '{{.ServerVersion}}'])) return true;
  }

  console.error('Docker Desktop did not become ready within 3 minutes.');
  return false;
}

async function main() {
  if (!(await ensureDocker())) process.exit(1);

  if (!run(docker, ['compose', 'up', '-d', 'mysql', 'backend'])) process.exit(1);
  if (!(await waitForPort(8080, 120_000))) {
    console.error('Backend did not become ready within 2 minutes.');
    run(docker, ['compose', 'logs', '--tail', '80', 'backend']);
    process.exit(1);
  }

  if (await isPortOpen(5173)) {
    console.log('Frontend is already running at http://127.0.0.1:5173');
    return;
  }

  const frontend = spawn(npm, ['run', 'dev', '--', '--strictPort'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });
  frontend.on('exit', (code) => process.exit(code ?? 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
