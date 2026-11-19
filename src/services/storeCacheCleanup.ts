import { getLoginUser } from './auth';
import { storeScopeFingerprint, markStoreCacheDeleted } from './storeCacheScope';
export { storeScopeFingerprint } from './storeCacheScope';
import { invalidateCurrentStoreScope } from './storeScopeValidity';

const pattern = /^zdm-order-prototype-v1:([1-9]\d{0,18}):([1-9]\d{0,18}):([1-9]\d{0,18}):([1-9]\d{0,18})$/;
const selectionPattern = /^zdm-selection-join:([1-9]\d{0,18}):([1-9]\d{0,18}):([1-9]\d{0,18})$/;
const selectionContextPattern = /^([1-9]\d{0,18}):([1-9]\d{0,18}):([1-9]\d{0,18})$/;
const selectionNoticeKey = 'zdm-selection-store-updated';
const maximum = 9223372036854775807n;

function selectionNoticeScope() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(selectionNoticeKey) ?? 'null');
    if (!value || typeof value !== 'object' || !('context' in value) || typeof value.context !== 'string') return null;
    const match = selectionContextPattern.exec(value.context);
    return match && match.slice(1).every((id) => BigInt(id) <= maximum) ? match : null;
  } catch {
    return null;
  }
}

export const cacheCleanupStatus = { checkedAt: '', removed: 0, pending: false };
let pending: Promise<void> | undefined;
function invalidateMatchingScope(fingerprints: string[], clearSession = false) {
  const user = getLoginUser();
  if (
    user.tenantId &&
    user.storeId &&
    fingerprints.includes(storeScopeFingerprint(String(user.tenantId), String(user.storeId)))
  ) {
    invalidateCurrentStoreScope();
    if (clearSession) window.dispatchEvent(new Event('zdm-auth-session-cleared'));
  }
}

export function sweepStoreCaches(): Promise<void> {
  if (pending) return pending;
  pending = sweep()
    .catch(() => {
      cacheCleanupStatus.pending = true;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
async function sweep() {
  if (!navigator.onLine) {
    cacheCleanupStatus.pending = true;
    return;
  }
  const scopes = new Map<string, { tenant: string; store: string; keys: string[] }>();
  const addScope = (tenant: string, store: string, key?: string) => {
    const fingerprint = storeScopeFingerprint(tenant, store);
    const scope = scopes.get(fingerprint) ?? { tenant, store, keys: [] };
    if (key) scope.keys.push(key);
    scopes.set(fingerprint, scope);
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    const match = pattern.exec(key) ?? selectionPattern.exec(key);
    if (!match || match.slice(1).some((value) => BigInt(value) > maximum)) continue;
    addScope(match[1]!, match[2]!, key);
  }
  const notice = selectionNoticeScope();
  if (notice) addScope(notice[1]!, notice[2]!);
  const current = getLoginUser();
  const currentIds = [String(current.tenantId), String(current.storeId)];
  if (currentIds.every((id) => /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= maximum))
    addScope(currentIds[0]!, currentIds[1]!);
  const fingerprints = [...scopes.keys()];
  cacheCleanupStatus.pending = false;
  for (let offset = 0; offset < fingerprints.length; offset += 100) {
    const batch = fingerprints.slice(offset, offset + 100);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}/open/store-cache-exits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ fingerprints: batch }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Cache scope verification unavailable');
      const result = await response.json();
      if (
        !navigator.onLine ||
        result.code !== 0 ||
        !Array.isArray(result.data) ||
        result.data.some((value: unknown) => typeof value !== 'string' || !batch.includes(value))
      )
        throw new Error('Cache scope verification invalid');
      const confirmed = [...new Set(result.data as string[])];
      if (confirmed.length) {
        invalidateMatchingScope(confirmed);
        try {
          for (const fingerprint of confirmed) {
            const scope = scopes.get(fingerprint)!;
            markStoreCacheDeleted(scope.tenant, scope.store);
          }
          window.dispatchEvent(new CustomEvent('zdm-store-cache-cleared', { detail: confirmed }));
          for (const fingerprint of confirmed) {
            const scope = scopes.get(fingerprint)!;
            for (const key of scope.keys) localStorage.removeItem(key);
            // Another tab may replace the shared notice while this request is pending.
            const currentNotice = selectionNoticeScope();
            const removeNotice =
              currentNotice && storeScopeFingerprint(currentNotice[1]!, currentNotice[2]!) === fingerprint;
            if (removeNotice) localStorage.removeItem(selectionNoticeKey);
            if (scope.keys.length || removeNotice) cacheCleanupStatus.removed++;
          }
        } finally {
          // Recheck the current identity after callbacks; never clear a different store's session.
          invalidateMatchingScope(confirmed, true);
        }
      }
      cacheCleanupStatus.checkedAt = new Date().toISOString();
    } finally {
      window.clearTimeout(timer);
    }
  }
}

export function startStoreCacheCleanup() {
  const run = () => {
    if (document.visibilityState !== 'hidden') void sweepStoreCaches();
  };
  const retiredInAnotherTab = (event: StorageEvent) => {
    const fingerprint = /^zdm-store-cache-retired-v1:([a-f0-9]{64})$/.exec(event.key ?? '')?.[1];
    if (event.storageArea !== localStorage || event.newValue !== '1' || !fingerprint) return;
    invalidateMatchingScope([fingerprint]);
    window.dispatchEvent(new CustomEvent('zdm-store-cache-cleared', { detail: [fingerprint] }));
    invalidateMatchingScope([fingerprint], true);
    run();
  };
  window.addEventListener('storage', retiredInAnotherTab);
  window.addEventListener('online', run);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', run);
  const timer = window.setInterval(run, 60000);
  run();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('storage', retiredInAnotherTab);
    window.removeEventListener('online', run);
    window.removeEventListener('focus', run);
    document.removeEventListener('visibilitychange', run);
  };
}
