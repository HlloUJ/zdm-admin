import path from 'node:path';
import { ensureBackend } from './backend-runtime.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--worktree'))
  throw new Error('Usage: backend:ensure [--worktree path]');
await ensureBackend(args.length ? path.resolve(args[1]) : process.cwd());
