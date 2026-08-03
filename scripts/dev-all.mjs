import { spawn } from 'node:child_process';

import { ensureBackend } from './backend-runtime.mjs';

const root = process.cwd();
await ensureBackend(root);
const frontend = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
frontend.on('exit', (code) => process.exit(code ?? 0));
