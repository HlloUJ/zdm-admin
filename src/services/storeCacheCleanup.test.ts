import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cacheCleanupStatus,
  storeScopeFingerprint,
  sweepStoreCaches,
  startStoreCacheCleanup,
} from './storeCacheCleanup';
import { getLoginUser, setLoginUser } from './auth';
import { getAuthToken, setAuthToken } from './http';
import { isCurrentStoreScopeVerified, requireCurrentStoreScope } from './storeScopeValidity';
const key = 'zdm-order-prototype-v1:1:2:3:4';
const other = 'zdm-order-prototype-v1:1:9:3:4';
let stop: (() => void) | undefined;
beforeEach(() => {
  window.dispatchEvent(new Event('zdm-auth-session-cleared'));
  localStorage.clear();
  vi.stubGlobal('navigator', { onLine: true });
  cacheCleanupStatus.removed = 0;
  cacheCleanupStatus.pending = false;
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
function reply(data: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => ({ code: 0, data }) };
}
it('matches Java SHA-256 scopes including identifiers across block boundaries', () => {
  for (const [tenant, store] of [
    ['1', '2'],
    ['9223372036854775807', '9223372036854775807'],
    ['17', '9007199254740993'],
  ]) {
    expect(storeScopeFingerprint(tenant!, store!)).toBe(
      createHash('sha256').update(`zdm-store-cache-v1:${tenant}:${store}`).digest('hex'),
    );
  }
});
it('clears only confirmed scopes and preserves unrelated local data without authentication', async () => {
  localStorage.setItem(key, 'orders');
  localStorage.setItem(other, 'other orders');
  localStorage.setItem('unrelated', 'keep');
  const fetch = vi.fn().mockResolvedValue(reply([storeScopeFingerprint('1', '2')]));
  vi.stubGlobal('fetch', fetch);
  const cleared = vi.fn();
  window.addEventListener('zdm-store-cache-cleared', cleared, { once: true });
  setAuthToken('matching-session');
  setLoginUser({ id: 4, identityId: 3, tenantId: 1, storeId: 2, name: '', phone: '', roles: [], permissions: [] });
  await sweepStoreCaches();
  expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem(other)).toBe('other orders');
  expect(localStorage.getItem('unrelated')).toBe('keep');
  expect(cleared).toHaveBeenCalledOnce();
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(getAuthToken()).toBeNull();
  expect(localStorage.getItem('zdm-admin-user')).toBeNull();
  expect(getLoginUser().storeId).toBeUndefined();
  expect(fetch.mock.calls[0]![1].credentials).toBe('omit');
  expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty('Authorization');
});
it('does not equate identity loss, empty results, server failures or invalid results with deletion', async () => {
  for (const response of [
    reply([]),
    reply([], 401),
    reply([], 403),
    reply([], 429),
    reply([], 503),
    reply(['f'.repeat(64)]),
  ]) {
    localStorage.setItem(key, 'preserve');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await sweepStoreCaches();
    expect(localStorage.getItem(key)).toBe('preserve');
  }
});
it('preserves offline records and retries on the next successful check', async () => {
  localStorage.setItem(key, 'old');
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { onLine: false });
  await sweepStoreCaches();
  expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal('navigator', { onLine: true });
  await sweepStoreCaches();
  expect(localStorage.getItem(key)).toBe('old');
  fetch.mockResolvedValue(reply([storeScopeFingerprint('1', '2')]));
  await sweepStoreCaches();
  expect(localStorage.getItem(key)).toBeNull();
});
it('bounds each request to 100 unique scopes, ignores malformed keys and does not duplicate in-flight requests', async () => {
  for (let i = 1; i <= 101; i++) localStorage.setItem(`zdm-order-prototype-v1:1:${i}:3:4`, 'old');
  localStorage.setItem('zdm-order-prototype-v1:1:9223372036854775808:3:4', 'invalid');
  const fetch = vi.fn().mockImplementation(async (_url, options) => reply(JSON.parse(options.body).fingerprints));
  vi.stubGlobal('fetch', fetch);
  await Promise.all([sweepStoreCaches(), sweepStoreCaches()]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0]![1].body).fingerprints).toHaveLength(100);
  expect(localStorage.getItem('zdm-order-prototype-v1:1:9223372036854775808:3:4')).toBe('invalid');
  expect(Object.keys(localStorage).filter((key) => key.startsWith('zdm-order-prototype-v1:'))).toHaveLength(1);
});
it('a local storage failure remains pending for retry', async () => {
  localStorage.setItem(key, 'old');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([storeScopeFingerprint('1', '2')])));
  const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('denied');
  });
  await sweepStoreCaches();
  expect(cacheCleanupStatus.pending).toBe(true);
  expect(localStorage.getItem(key)).toBe('old');
  remove.mockRestore();
  await sweepStoreCaches();
  expect(localStorage.getItem(key)).toBeNull();
});
it('periodic and online sweeps stop on teardown', async () => {
  vi.useFakeTimers();
  localStorage.setItem(key, 'old');
  const fetch = vi.fn().mockResolvedValue(reply([]));
  vi.stubGlobal('fetch', fetch);
  stop = startStoreCacheCleanup();
  await sweepStoreCaches();
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetch).toHaveBeenCalledTimes(2);
  stop();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(60000);
  window.dispatchEvent(new Event('online'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('permanent cleanup prevents an in-flight stale identity response from reopening the old scope', async () => {
  const user = { id: 4, identityId: 3, tenantId: 2026, storeId: 99, name: '', phone: '', roles: [], permissions: [] };
  const target = 'zdm-order-prototype-v1:2026:99:3:4';
  const fingerprint = storeScopeFingerprint('2026', '99');
  localStorage.setItem(target, 'old');
  setAuthToken('previous-store-token');
  setLoginUser(user);
  let complete!: (value: unknown) => void;
  const valid = reply([user]);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(valid)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(reply([fingerprint]));
  vi.stubGlobal('fetch', fetch);
  await requireCurrentStoreScope();
  expect(isCurrentStoreScopeVerified()).toBe(true);
  const pending = requireCurrentStoreScope();
  const rejected = expect(pending).rejects.toThrow('门店已彻底删除');
  await sweepStoreCaches();
  expect(localStorage.getItem(target)).toBeNull();
  complete(valid);
  await rejected;
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(getAuthToken()).toBeNull();
  await expect(requireCurrentStoreScope()).rejects.toThrow('当前身份不属于门店');
});

it('another tab permanent-deletion marker immediately invalidates an open scope while uncertain cleanup preserves records', async () => {
  const user = { id: 4, identityId: 3, tenantId: 2027, storeId: 99, name: '', phone: '', roles: [], permissions: [] };
  const target = 'zdm-order-prototype-v1:2027:99:3:4';
  localStorage.setItem(target, 'other tab order');
  setAuthToken('store-token');
  setLoginUser(user);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(reply([user]))
      .mockResolvedValue(reply([])),
  );
  await requireCurrentStoreScope();
  expect(isCurrentStoreScopeVerified()).toBe(true);
  const cleared = vi.fn();
  window.addEventListener('zdm-store-cache-cleared', cleared, { once: true });
  stop = startStoreCacheCleanup();
  await sweepStoreCaches();
  const marker = `zdm-store-cache-retired-v1:${storeScopeFingerprint('2027', '99')}`;
  localStorage.setItem(marker, '1');
  window.dispatchEvent(new StorageEvent('storage', { key: marker, newValue: '1', storageArea: localStorage }));
  expect(isCurrentStoreScopeVerified()).toBe(false);
  expect(cleared).toHaveBeenCalledOnce();
  await sweepStoreCaches();
  expect(localStorage.getItem(target)).toBe('other tab order');
});

it('a current retired session is checked and cleared even without an order cache', async () => {
  setAuthToken('current-token');
  setLoginUser({
    id: 4,
    identityId: 3,
    tenantId: 2028,
    storeId: 99,
    name: '旧门店人员',
    phone: '',
    roles: [],
    permissions: [],
  });
  const fingerprint = storeScopeFingerprint('2028', '99');
  const fetch = vi.fn().mockResolvedValue(reply([fingerprint]));
  vi.stubGlobal('fetch', fetch);
  localStorage.setItem('unrelated-preference', 'keep');
  await sweepStoreCaches();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).fingerprints).toEqual([fingerprint]);
  expect(getAuthToken()).toBeNull();
  expect(localStorage.getItem('zdm-admin-user')).toBeNull();
  expect(localStorage.getItem('unrelated-preference')).toBe('keep');
});

it('a different current store keeps its session when another store is proven deleted', async () => {
  localStorage.setItem(key, 'old orders');
  setAuthToken('other-store-token');
  setLoginUser({
    id: 4,
    identityId: 33,
    tenantId: 1,
    storeId: 9,
    name: '另一门店人员',
    phone: '',
    roles: [],
    permissions: [],
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply([storeScopeFingerprint('1', '2')])));
  await sweepStoreCaches();
  expect(localStorage.getItem(key)).toBeNull();
  expect(getAuthToken()).toBe('other-store-token');
  expect(getLoginUser().storeId).toBe(9);
});

it('switching to a valid identity while a deletion check is pending does not log out the new identity', async () => {
  setAuthToken('original');
  setLoginUser({
    id: 4,
    identityId: 3,
    tenantId: 2029,
    storeId: 99,
    name: '原身份',
    phone: '',
    roles: [],
    permissions: [],
  });
  let resolve!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  );
  const pending = sweepStoreCaches();
  setAuthToken('new-session');
  setLoginUser({
    id: 4,
    identityId: 44,
    tenantId: 2030,
    storeId: 8,
    name: '新身份',
    phone: '',
    roles: [],
    permissions: [],
  });
  resolve(reply([storeScopeFingerprint('2029', '99')]));
  await pending;
  expect(getAuthToken()).toBe('new-session');
  expect(getLoginUser().storeId).toBe(8);
});

it('discovers selection-only scopes and removes every account of only the confirmed deleted store', async () => {
  const removed = ['zdm-selection-join:41:52:63', 'zdm-selection-join:41:52:64'];
  const kept = [
    'zdm-selection-join:41:53:63',
    'zdm-selection-join:42:52:63',
    'zdm-selection-join:41:52:0',
    'zdm-selection-join:41:52:9223372036854775808',
    'zdm-selection-join:41:52:63:extra',
    'zdm-selection-join:041:52:63',
  ];
  [...removed, ...kept].forEach((key) => localStorage.setItem(key, 'request-uuid'));
  localStorage.setItem('zdm-selection-store-updated', JSON.stringify({ context: '41:52:64', time: 123 }));
  const fetch = vi.fn().mockResolvedValue(reply([storeScopeFingerprint('41', '52')]));
  vi.stubGlobal('fetch', fetch);
  await sweepStoreCaches();
  removed.forEach((key) => expect(localStorage.getItem(key)).toBeNull());
  kept.forEach((key) => expect(localStorage.getItem(key)).toBe('request-uuid'));
  expect(localStorage.getItem('zdm-selection-store-updated')).toBeNull();
  expect(JSON.parse(fetch.mock.calls[0]![1].body).fingerprints).toHaveLength(3);
});

it('discovers a notification-only scope and preserves malformed or unconfirmed selection metadata', async () => {
  const noticeKey = 'zdm-selection-store-updated';
  const target = 'zdm-selection-join:61:62:63';
  const fetch = vi.fn().mockResolvedValue(reply([]));
  vi.stubGlobal('fetch', fetch);
  for (const notice of [
    'bad json',
    'null',
    '[]',
    '{"context":12}',
    '{"context":"61:62:0"}',
    '{"context":"61:62:9223372036854775808"}',
  ]) {
    localStorage.setItem(noticeKey, notice);
    await sweepStoreCaches();
    expect(localStorage.getItem(noticeKey)).toBe(notice);
  }
  expect(fetch).not.toHaveBeenCalled();
  localStorage.setItem(target, 'uuid');
  const notice = JSON.stringify({ context: '61:62:63', time: 123 });
  for (const response of [reply([]), reply([], 401), reply([], 503), reply(['f'.repeat(64)])]) {
    localStorage.setItem(noticeKey, notice);
    fetch.mockResolvedValue(response);
    await sweepStoreCaches();
    expect(localStorage.getItem(target)).toBe('uuid');
    expect(localStorage.getItem(noticeKey)).toBe(notice);
  }
  localStorage.removeItem(target);
  fetch.mockResolvedValue(reply([storeScopeFingerprint('61', '62')]));
  await sweepStoreCaches();
  expect(localStorage.getItem(noticeKey)).toBeNull();
});

it('preserves a different store notification written while deletion verification is pending', async () => {
  const noticeKey = 'zdm-selection-store-updated';
  localStorage.setItem(noticeKey, JSON.stringify({ context: '71:72:73', time: 1 }));
  let resolve!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  );
  const pending = sweepStoreCaches();
  const replacement = JSON.stringify({ context: '71:74:75', time: 2 });
  localStorage.setItem(noticeKey, replacement);
  resolve(reply([storeScopeFingerprint('71', '72')]));
  await pending;
  expect(localStorage.getItem(noticeKey)).toBe(replacement);
});
