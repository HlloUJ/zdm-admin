import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { taskPreviewControlPlugin } from './task-preview-control.mjs';

function request({ runtimeId = 'runtime-a', method = 'GET', headers = {}, url = '/__zdm_task_preview__' } = {}) {
  let middleware,
    next = false;
  const server = {
    middlewares: {
      use: (value) => {
        middleware = value;
      },
    },
    close: () => assert.fail('Refused request must not close a server'),
  };
  taskPreviewControlPlugin({
    workspaceRoot: '/repo/a',
    branch: 'codex/a',
    mode: 'full',
    apiTarget: 'http://127.0.0.1:8081',
    runtimeId,
  }).configureServer(server);
  const response = {
    statusCode: 200,
    setHeader: () => {},
    end: (body) => {
      response.body = body;
    },
  };
  middleware({ method, headers, url }, response, () => {
    next = true;
  });
  return { response, next };
}
test('runtime identity is visible without changing legacy metadata or ordinary page handling', () => {
  assert.equal(JSON.parse(request().response.body).runtimeId, 'runtime-a');
  assert.equal(JSON.parse(request({ runtimeId: null }).response.body).runtimeId, undefined);
  assert.equal(request({ url: '/api/products' }).next, true);
});
test('missing and stale runtime identities cannot stop a newly selected preview', () => {
  for (const token of [undefined, 'runtime-before-restart', 'runtime-b']) {
    const result = request({
      method: 'DELETE',
      headers: {
        'x-zdm-task-preview-control': 'switch-current-task',
        ...(token ? { 'x-zdm-task-runtime-id': token } : {}),
      },
    });
    assert.equal(result.response.statusCode, 409);
  }
  assert.equal(
    request({
      runtimeId: null,
      method: 'DELETE',
      headers: {
        'x-zdm-task-preview-control': 'switch-current-task',
        'x-zdm-task-runtime-id': 'runtime-a',
      },
    }).response.statusCode,
    409,
  );
  assert.equal(request({ method: 'DELETE' }).response.statusCode, 405);
});
test('the exact runtime identity closes its own server and legacy stop remains supported', () => {
  for (const runtimeId of [null, 'runtime-a']) {
    const source = `import {taskPreviewControlPlugin} from ${JSON.stringify(new URL('./task-preview-control.mjs', import.meta.url).href)};
      let middleware;
      const server={middlewares:{use:fn=>middleware=fn},close:async()=>{console.log('closed-own-server')}};
      taskPreviewControlPlugin({workspaceRoot:'/repo/a',branch:'codex/a',mode:'full',apiTarget:'http://127.0.0.1:8081',runtimeId:${JSON.stringify(runtimeId)}}).configureServer(server);
      middleware({url:'/__zdm_task_preview__',method:'DELETE',headers:{'x-zdm-task-preview-control':'switch-current-task',${runtimeId ? "'x-zdm-task-runtime-id':'runtime-a'" : ''}}},{statusCode:200,end(){console.log('accepted')}},()=>{});
      await new Promise(resolve=>setTimeout(resolve,200));`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
    assert.match(result, /accepted/);
    assert.match(result, /closed-own-server/);
  }
});
