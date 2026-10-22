import type { LoginUser } from './auth';
import { getUserFunctionAudience } from './functionAudience';

/** Local task preview only; never modifies the signed-in user's real grants. */
export function canPreviewStoreOrders(user: LoginUser, permission?: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const { hostname, port, protocol } = window.location;
  return (
    protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) &&
    port === '5175' &&
    getUserFunctionAudience(user) === 'store' &&
    Boolean(permission === 'store.order-management' || permission?.startsWith('store.order-management.'))
  );
}
