import { defineConfig } from 'vite';
import base from './vite.config.js';
import { readApplicationManifest } from './scripts/e2e-app.mjs';
import path from 'node:path';
export default defineConfig((env) => {
  const config = base(env);
  const manifest = readApplicationManifest(config.root);
  return {
    ...config,
    build: {
      ...config.build,
      outDir: '.task-runtime/e2e-app',
      rollupOptions: { input: manifest.entries.map((entry) => path.resolve(config.root, entry)) },
    },
  };
});
