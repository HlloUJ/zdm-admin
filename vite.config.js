import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const TASK_PREVIEW_CONTROL_PATH = '/__zdm_task_preview__';
const TASK_PREVIEW_API_HEALTH_PATH = '/__zdm_task_preview_api_health__';
const TASK_PREVIEW_CONTROL_HEADER = 'x-zdm-task-preview-control';
const TASK_PREVIEW_CONTROL_VALUE = 'switch-current-task';

function taskPreviewControlPlugin({ workspaceRoot, branch, mode, apiTarget, combination }) {
  return {
    name: 'zdm-task-preview-control',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== TASK_PREVIEW_CONTROL_PATH) {
          next();
          return;
        }
        if (request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(
            JSON.stringify({
              type: 'zdm-task-preview',
              workspaceRoot,
              branch,
              mode,
              apiTarget,
              ...(combination ? { combination } : {}),
            }),
          );
          return;
        }
        if (
          request.method === 'DELETE' &&
          request.headers[TASK_PREVIEW_CONTROL_HEADER] === TASK_PREVIEW_CONTROL_VALUE
        ) {
          response.statusCode = 202;
          response.end('switching');
          const shutdownTimer = setTimeout(() => {
            void server.close().finally(() => process.exit(0));
          }, 25);
          shutdownTimer.unref();
          return;
        }
        response.statusCode = 405;
        response.end('method not allowed');
      });
    },
  };
}

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
  const combination =
    taskPreview && process.env.ZDM_TASK_COMBINATION ? JSON.parse(process.env.ZDM_TASK_COMBINATION) : null;
  if (
    combination &&
    (combination.worktree !== workspaceRoot ||
      combination.branch !== taskBranch ||
      !Number.isInteger(frontendPort) ||
      frontendPort < 5177 ||
      frontendPort > 5199 ||
      combination.eligibleForTaskDelivery !== false)
  )
    throw new Error('组合预览归属或临时端口不符');

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
              combination,
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
