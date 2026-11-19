import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getLoginUser, setLoginUser } from './auth';
import { getAuthToken, setAuthToken } from './http';
import {
  requireCurrentStoreScope,
  invalidateCurrentStoreScope,
  isCurrentStoreScopeVerified,
  startCurrentStoreScopeMonitor,
} from './storeScopeValidity';
const user = { id: 7, identityId: 7, name: '导购', phone: '', roles: [], permissions: [], tenantId: 1, storeId: 2 };
beforeEach(() => {
  invalidateCurrentStoreScope();
  setAuthToken('scope-a');
  setLoginUser(user);
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('allows only the currently valid identity and never sends a mutation', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: [user] }) });
  vi.stubGlobal('fetch', fetch);
  await requireCurrentStoreScope();
  expect(fetch.mock.calls[0][0]).toBe('/api/admin/auth/contexts');
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
});
it('invalidates a removed identity while preserving local prototype records', async () => {
  localStorage.setItem('zdm-order-prototype-v1:1:2:7:7', 'preserved-offline-copy');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: [] }) }),
  );
  await expect(requireCurrentStoreScope()).rejects.toThrow('门店身份已失效');
  expect(getAuthToken()).toBeNull();
  expect(localStorage.getItem('zdm-order-prototype-v1:1:2:7:7')).toBe('preserved-offline-copy');
});
it('blocks offline use without treating a network failure as permanent deletion', async () => {
  vi.stubGlobal('navigator', { onLine: false });
  await expect(requireCurrentStoreScope()).rejects.toThrow('请联网');
  expect(getAuthToken()).toBe('scope-a');
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
  await expect(requireCurrentStoreScope()).rejects.toThrow('network unavailable');
  expect(getAuthToken()).toBe('scope-a');
});
it('a delayed check cannot clear a newer identity', async () => {
  let complete!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const pending = requireCurrentStoreScope();
  setAuthToken('scope-b');
  setLoginUser({ ...user, identityId: 8, storeId: 3 });
  complete({ ok: true, status: 200, json: async () => ({ code: 0, data: [] }) });
  await expect(pending).rejects.toThrow('当前身份已变化');
  expect(getAuthToken()).toBe('scope-b');
  expect(getLoginUser().storeId).toBe(3);
});

it('an already-open online page is periodically invalidated and stopping removes all listeners', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let available = true;
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ code: 0, data: available ? [user] : [] }),
  }));
  vi.stubGlobal('fetch', fetch);
  const error = vi.fn();
  const stop = startCurrentStoreScopeMonitor(error);
  await vi.advanceTimersByTimeAsync(0);
  expect(isCurrentStoreScopeVerified()).toBe(true);
  available = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(getAuthToken()).toBeNull();
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(error).toHaveBeenCalledOnce();
  stop();
  const calls = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(45_000);
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(error).toHaveBeenCalledOnce();
});
it('temporary failure hides cached reads while retaining credentials and records, then revalidates', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const key = 'zdm-order-prototype-v1:1:2:7:7';
  localStorage.setItem(key, 'unchanged-order-records');
  let fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (fail) throw new TypeError('offline during verification');
      return { ok: true, status: 200, json: async () => ({ code: 0, data: [user] }) };
    }),
  );
  const stop = startCurrentStoreScopeMonitor(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  expect(isCurrentStoreScopeVerified()).toBe(true);
  fail = true;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(getAuthToken()).toBe('scope-a');
  expect(localStorage.getItem(key)).toBe('unchanged-order-records');
  fail = false;
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
  expect(isCurrentStoreScopeVerified()).toBe(true);
  expect(localStorage.getItem(key)).toBe('unchanged-order-records');
  stop();
});
it('focus and visibility changes immediately verify an existing page without overlapping monitor requests', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: [user] }) }));
  vi.stubGlobal('fetch', fetch);
  const stop = startCurrentStoreScopeMonitor(vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
});
it('a response started before disconnect cannot authorize reads after reconnect', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let complete!: (value: unknown) => void;
  const response = { ok: true, status: 200, json: async () => ({ code: 0, data: [user] }) };
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  const stop = startCurrentStoreScopeMonitor(vi.fn());
  vi.stubGlobal('navigator', { onLine: false });
  window.dispatchEvent(new Event('offline'));
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(getAuthToken()).toBe('scope-a');
  vi.stubGlobal('navigator', { onLine: true });
  window.dispatchEvent(new Event('online'));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(isCurrentStoreScopeVerified()).toBe(false);
  complete(response);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(isCurrentStoreScopeVerified()).toBe(true);
  stop();
});

it('a hung verification expires without logging out or deleting cached records', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        }),
    ),
  );
  const pending = requireCurrentStoreScope();
  const rejected = expect(pending).rejects.toThrow('门店身份核验超时');
  await vi.advanceTimersByTimeAsync(5_000);
  await rejected;
  expect(getAuthToken()).toBe('scope-a');
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('stopping a page monitor aborts its pending check and releases its timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        }),
    ),
  );
  const error = vi.fn();
  const stop = startCurrentStoreScopeMonitor(error);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(error).not.toHaveBeenCalled();
  expect(getAuthToken()).toBe('scope-a');
});

it.each(['resolved', 'rejected'])('a late %s check cannot replace the offline explanation', async (outcome) => {
  vi.useFakeTimers();
  let complete!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve, rejectRequest) => {
          complete = resolve;
          reject = rejectRequest;
        }),
    ),
  );
  const error = vi.fn();
  const stop = startCurrentStoreScopeMonitor(error);
  vi.stubGlobal('navigator', { onLine: false });
  window.dispatchEvent(new Event('offline'));
  if (outcome === 'resolved') complete({ ok: true, status: 200, json: async () => ({ code: 0, data: [user] }) });
  else reject(new TypeError('Failed to fetch'));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledTimes(2);
  for (const [failure] of error.mock.calls) expect(failure.message).toBe('请联网核验门店身份后再操作');
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(getAuthToken()).toBe('scope-a');
  stop();
});
