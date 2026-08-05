import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const taskPreview = process.env.ZDM_TASK_PREVIEW === '1';
  const publicOriginValue = process.env.VITE_PUBLIC_APP_ORIGIN || env.VITE_PUBLIC_APP_ORIGIN;
  const publicOrigin = !taskPreview && publicOriginValue ? new URL(publicOriginValue) : null;
  const frontendPort = Number(process.env.ZDM_FRONTEND_PORT || 5173);
  const apiProxyTarget = process.env.ZDM_API_PROXY_TARGET || 'http://127.0.0.1:8080';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: taskPreview ? '127.0.0.1' : '0.0.0.0',
      port: frontendPort,
      strictPort: taskPreview,
      allowedHosts: true,
      hmr: publicOrigin
        ? {
            host: publicOrigin.hostname,
            clientPort: Number(publicOrigin.port || 5173),
          }
        : undefined,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
