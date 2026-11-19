import { shallowRef } from 'vue';
import { storeCacheIsDeleted } from './storeCacheScope';
import { getLoginUser, listIdentityContexts } from './auth';
import { ApiError, getAuthToken } from './http';

const snapshot = () => {
  const user = getLoginUser();
  return `${getAuthToken()}:${user.id}:${user.identityId}:${user.tenantId}:${user.storeId}`;
};

const verifiedScope = shallowRef('');
let connectivityEpoch = 0;
export function invalidateCurrentStoreScope() {
  verifiedScope.value = '';
  connectivityEpoch++;
}
export function isCurrentStoreScopeVerified() {
  const user = getLoginUser();
  return (
    Boolean(getAuthToken()) &&
    navigator.onLine &&
    !storeCacheIsDeleted(String(user.tenantId), String(user.storeId)) &&
    verifiedScope.value === snapshot()
  );
}

/** Local prototype data may be used only after its current server-side identity is revalidated. */
export async function requireCurrentStoreScope(signal?: AbortSignal) {
  const user = getLoginUser();
  if (!user.storeId) {
    invalidateCurrentStoreScope();
    throw new Error('当前身份不属于门店');
  }
  if (storeCacheIsDeleted(String(user.tenantId), String(user.storeId))) {
    invalidateCurrentStoreScope();
    window.dispatchEvent(new Event('zdm-auth-session-cleared'));
    throw new Error('门店已彻底删除');
  }
  const captured = snapshot();
  const capturedEpoch = connectivityEpoch;
  if (!navigator.onLine) {
    invalidateCurrentStoreScope();
    throw new Error('请联网核验门店身份后再操作');
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new Error('门店身份核验超时，请稍后重试')), 5_000);
  try {
    const contexts = await listIdentityContexts(controller.signal);
    if (!navigator.onLine || capturedEpoch !== connectivityEpoch) throw new Error('网络状态已变化，请重新核验门店身份');
    if (storeCacheIsDeleted(String(user.tenantId), String(user.storeId))) throw new Error('门店已彻底删除');
    if (captured !== snapshot()) throw new Error('当前身份已变化，请重新操作');
    if (
      !contexts.some(
        (context) =>
          context.identityId === user.identityId &&
          context.storeId === user.storeId &&
          context.tenantId === user.tenantId,
      )
    ) {
      invalidateCurrentStoreScope();
      window.dispatchEvent(new Event('zdm-auth-session-cleared'));
      throw new Error('门店身份已失效，请重新登录');
    }
    verifiedScope.value = captured;
  } catch (error) {
    if (storeCacheIsDeleted(String(user.tenantId), String(user.storeId))) {
      if (captured === snapshot()) {
        invalidateCurrentStoreScope();
        window.dispatchEvent(new Event('zdm-auth-session-cleared'));
      }
      throw new Error('门店已彻底删除', { cause: error });
    }
    if (!getAuthToken() || (captured === snapshot() && capturedEpoch === connectivityEpoch)) verifiedScope.value = '';
    if (
      captured === snapshot() &&
      capturedEpoch === connectivityEpoch &&
      error instanceof ApiError &&
      [401, 403].includes(error.status)
    ) {
      window.dispatchEvent(new Event('zdm-auth-session-cleared'));
    }
    throw navigator.onLine ? error : new Error('请联网核验门店身份后再操作');
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** Revalidate an already-open local page; stopping never deletes the cached business records. */
export function startCurrentStoreScopeMonitor(onError: (error: unknown) => void, intervalMs = 15_000) {
  let active = true;
  let pending: Promise<void> | undefined;
  let verifyAfterPending = false;
  let requestController: AbortController | undefined;
  const verify = () => {
    if (!active || pending) return;
    requestController = new AbortController();
    pending = requireCurrentStoreScope(requestController.signal)
      .catch((error: unknown) => {
        if (active) onError(error);
      })
      .finally(() => {
        pending = undefined;
        requestController = undefined;
        if (active && verifyAfterPending) {
          verifyAfterPending = false;
          verify();
        }
      });
  };
  const online = () => {
    invalidateCurrentStoreScope();
    if (pending) verifyAfterPending = true;
    else verify();
  };
  const offline = () => {
    invalidateCurrentStoreScope();
    if (active) onError(new Error('请联网核验门店身份后再操作'));
  };
  const visible = () => {
    if (document.visibilityState !== 'hidden') verify();
  };
  const timer = window.setInterval(visible, intervalMs);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  verify();
  return () => {
    active = false;
    window.clearInterval(timer);
    requestController?.abort();
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}
