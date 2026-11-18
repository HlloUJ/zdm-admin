import assert from 'node:assert/strict';
import * as http from 'node:http';
import { createRequire } from 'node:module';

function installProxy(env) {
  if (typeof http.setGlobalProxyFromEnv === 'function') return http.setGlobalProxyFromEnv(env);
  const require = createRequire(import.meta.url);
  const { EnvHttpProxyAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');
  const previous = getGlobalDispatcher();
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      httpProxy: env.http_proxy || env.HTTP_PROXY,
      httpsProxy: env.https_proxy || env.HTTPS_PROXY,
      noProxy: env.no_proxy || env.NO_PROXY,
    }),
  );
  return () => setGlobalDispatcher(previous);
}

// Respect the user's existing proxy/no_proxy configuration. Descendant Node
// processes inherit the same supported setting; no credentials are logged.
export function configureTaskNetwork(env = process.env, configure = installProxy) {
  if (env.NODE_USE_ENV_PROXY === '0') return { enabled: false, reason: 'explicitly-disabled' };
  const all = env.all_proxy || env.ALL_PROXY;
  const http = env.http_proxy || env.HTTP_PROXY || all;
  const https = env.https_proxy || env.HTTPS_PROXY || all;
  if (!http && !https) return { enabled: false, reason: 'no-proxy-configured' };
  for (const value of [http, https].filter(Boolean)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw Error('Existing task proxy configuration is invalid');
    }
    assert.ok(['http:', 'https:'].includes(parsed.protocol), 'Existing task proxy protocol is unsupported');
  }
  if (!env.http_proxy && !env.HTTP_PROXY && http) env.HTTP_PROXY = http;
  if (!env.https_proxy && !env.HTTPS_PROXY && https) env.HTTPS_PROXY = https;
  env.NODE_USE_ENV_PROXY = '1';
  let restore;
  try {
    restore = configure(env);
  } catch {
    throw Error('Existing task proxy configuration could not be applied; check runtime and project dependencies');
  }
  return { enabled: true, restore };
}

export class TaskNetworkError extends Error {
  constructor(category, status = null, code = null) {
    super(
      `Task board ${category} failure${status ? ` (HTTP ${status})` : ''}${code ? ` [${code}]` : ''}; preserve original intake and queue`,
    );
    this.category = category;
    this.httpStatus = status;
  }
}
export function boardHttpFailureCategory(status, body = '') {
  return status === 401
    ? 'authentication'
    : status === 403
      ? /Cloudflare|Attention Required|<html/i.test(body)
        ? 'network-policy'
        : 'authorization'
      : status === 429 || status >= 500
        ? 'service'
        : 'http';
}
export async function readBoardTask({ url, token, id, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(url + '/service/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + token },
      body: JSON.stringify({ operation: 'get_task_progress_receipt', args: { id, receipt_id: 'title-sync-' + id } }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    const code = error.cause?.code ?? error.code;
    throw new TaskNetworkError('network', null, /^[A-Z][A-Z0-9_]{1,60}$/.test(code ?? '') ? code : null);
  }
  let body;
  try {
    body = await response.text();
  } catch {
    throw new TaskNetworkError('network', response.status);
  }
  if (!response.ok) {
    const category = boardHttpFailureCategory(response.status, body);
    throw new TaskNetworkError(category, response.status);
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TaskNetworkError('invalid-response', response.status);
  }
  if (parsed.error || parsed.data?.task?.id !== id) throw new TaskNetworkError('invalid-response', response.status);
  return parsed.data.task;
}

configureTaskNetwork();
