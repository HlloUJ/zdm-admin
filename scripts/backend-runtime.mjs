import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function normalizeDockerMountPath(mountPath) {
  if (process.platform === 'darwin' && mountPath.startsWith('/host_mnt/')) {
    return mountPath.slice('/host_mnt'.length);
  }
  return mountPath;
}

export function waitForPort(port, timeoutMs = 120_000) {
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

export async function ensureBackend(root) {
  if (!capture(root, 'docker', ['info', '--format', '{{.ServerVersion}}'])) {
    console.error('Docker is unavailable. Start Docker Desktop and retry.');
    process.exit(1);
  }

  const services = new Set(
    capture(root, 'docker', ['compose', 'ps', '-a', '--services']).split(/\r?\n/).filter(Boolean),
  );
  const backendWorkspace = capture(root, 'docker', [
    'inspect',
    '--format',
    '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}',
    'zdm-platform-backend',
  ]);
  const backendUsesCurrentWorktree =
    backendWorkspace && path.resolve(normalizeDockerMountPath(backendWorkspace)) === path.resolve(root);

  if (services.has('mysql') && services.has('backend') && backendUsesCurrentWorktree) {
    run(root, 'docker', ['compose', 'start', 'mysql']);
    await waitForPort(3306);
    run(root, 'docker', ['compose', 'start', 'backend']);
  } else {
    run(root, 'docker', ['compose', 'up', '-d', 'mysql']);
    await waitForPort(3306);
    run(root, 'docker', ['compose', 'up', '-d', '--force-recreate', 'backend']);
  }

  try {
    await waitForPort(8080);
  } catch (error) {
    console.error(error.message);
    run(root, 'docker', ['compose', 'logs', '--tail', '80', 'backend']);
    process.exit(1);
  }

  console.log(`Backend is ready from ${root} at http://127.0.0.1:8080`);
}
