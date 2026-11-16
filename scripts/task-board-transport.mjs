import assert from 'node:assert/strict';
const boardURL = 'https://uj-task-board-preview-nov12.hanjian-uj.chatgpt.site';
// In-memory owner credential; no argv/env/file logging. The only target is the existing417 service.
export function createOwnerBoardCall({ url, token }, { request = fetch } = {}) {
  assert.equal(url, boardURL);
  assert.ok(typeof token === 'string' && token.length > 0);
  return async (operation, args, { signal } = {}) => {
    assert.ok(['get_task_progress_receipt', 'apply_task_progress_receipt', 'task_history'].includes(operation));
    let response;
    try {
      response = await request(url + '/service/tasks', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + token },
        body: JSON.stringify({ operation, args }),
        signal: signal ?? AbortSignal.timeout(30000),
      });
    } catch {
      const error = Error('Board transport unavailable');
      error.code = 'transport_unavailable';
      throw error;
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      const error = Error('Board returned non-JSON');
      error.code = 'transport_http_' + response.status;
      throw error;
    }
    const body = await response.json();
    if (!response.ok || body.error) {
      const error = Error('Board receipt operation failed');
      error.code = body.code ?? 'transport_unavailable';
      error.boardResponse = body;
      throw error;
    }
    return body.data;
  };
}
