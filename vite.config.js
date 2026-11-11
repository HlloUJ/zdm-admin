import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';
import { taskPreviewControlPlugin } from './scripts/task-preview-control.mjs';

const TASK_PREVIEW_API_HEALTH_PATH = '/__zdm_task_preview_api_health__';

export default defineConfig(({ mode }) => {
  const taskPreview = process.env.ZDM_TASK_PREVIEW === '1';
  const workspaceRoot = taskPreview
    ? resolve(process.env.ZDM_TASK_WORKSPACE || process.cwd())
    : fileURLToPath(new URL('.', import.meta.url));
  const env = loadEnv(mode, workspaceRoot, '');
  const publicOriginValue = process.env.VITE_PUBLIC_APP_ORIGIN || env.VITE_PUBLIC_APP_ORIGIN;
  const publicOrigin = !taskPreview && publicOriginValue ? new URL(publicOriginValue) : null;
  const frontendPort = Number(process.env.ZDM_FRONTEND_PORT || 5173);
  const apiProxyTarget = process.env.ZDM_API_PROXY_TARGET || 'http://127.0.0.1:8080';
  const taskBranch = process.env.ZDM_TASK_BRANCH || '';
  const taskMode = process.env.ZDM_TASK_MODE || '';

  return {
    root: workspaceRoot,
    cacheDir: resolve(workspaceRoot, '.task-runtime/cache/vite'),
    plugins: [
      vue(),
      ...(taskPreview
        ? [
            taskPreviewControlPlugin({
              workspaceRoot,
              branch: taskBranch,
              mode: taskMode,
              apiTarget: apiProxyTarget,
              runtimeId: process.env.ZDM_TASK_RUNTIME_ID || null,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': resolve(workspaceRoot, 'src'),
      },
    },
    server: {
      watch: { ignored: ['**/backend/target/**', '**/.task-verification/**', '**/.task-runtime/**'] },
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
        ...(taskPreview
          ? {
              [TASK_PREVIEW_API_HEALTH_PATH]: {
                target: apiProxyTarget,
                changeOrigin: true,
                rewrite: () => '/actuator/health',
              },
            }
          : {}),
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
