import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicOrigin = env.VITE_PUBLIC_APP_ORIGIN ? new URL(env.VITE_PUBLIC_APP_ORIGIN) : null;

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      hmr: publicOrigin
        ? {
            host: publicOrigin.hostname,
            clientPort: Number(publicOrigin.port || 5173),
          }
        : undefined,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
