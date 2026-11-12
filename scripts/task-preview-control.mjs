// Shared by the Vite config and the independent task controller. Legacy 5175
// previews retain their protocol; independently leased previews require their
// exact runtime nonce before accepting a stop request.
export function taskPreviewControlPlugin({ workspaceRoot, branch, mode, apiTarget, runtimeId = null }) {
  return {
    name: 'zdm-task-preview-control',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname !== '/__zdm_task_preview__') return next();
        if (request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(
            JSON.stringify({
              type: 'zdm-task-preview',
              workspaceRoot,
              branch,
              mode,
              apiTarget,
              ...(runtimeId ? { runtimeId } : {}),
            }),
          );
          return;
        }
        if (request.method === 'DELETE' && request.headers['x-zdm-task-preview-control'] === 'switch-current-task') {
          if (
            (runtimeId || request.headers['x-zdm-task-runtime-id']) &&
            request.headers['x-zdm-task-runtime-id'] !== runtimeId
          ) {
            response.statusCode = 409;
            response.end('Task runtime changed; preserve the current preview');
            return;
          }
          response.statusCode = 202;
          response.end('switching');
          const timer = setTimeout(() => {
            void server.close().finally(() => process.exit(0));
          }, 25);
          timer.unref();
          return;
        }
        response.statusCode = 405;
        response.end('method not allowed');
      });
    },
  };
}
