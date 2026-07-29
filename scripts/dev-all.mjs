import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const root = process.cwd();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function waitForPort(port, timeoutMs = 120_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.setTimeout(1_000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}.`));
          return;
        }
        setTimeout(attempt, 1_000);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    attempt();
  });
}

if (!capture('docker', ['info', '--format', '{{.ServerVersion}}'])) {
  console.error('Docker is unavailable. Start Docker Desktop and retry.');
  process.exit(1);
}

const services = new Set(capture('docker', ['compose', 'ps', '-a', '--services']).split(/\r?\n/).filter(Boolean));

if (services.has('mysql') && services.has('backend')) {
  run('docker', ['compose', 'start', 'mysql']);
  await waitForPort(3306);
  run('docker', ['compose', 'start', 'backend']);
} else {
  run('docker', ['compose', 'up', '-d', 'mysql', 'backend']);
}

try {
  await waitForPort(8080);
} catch (error) {
  console.error(error.message);
  run('docker', ['compose', 'logs', '--tail', '80', 'backend']);
  process.exit(1);
}

console.log('Backend is ready at http://127.0.0.1:8080');
const frontend = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
frontend.on('exit', (code) => process.exit(code ?? 0));
