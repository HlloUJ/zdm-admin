const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED_MESSAGE = '登录已失效，请重新登录';

export class SessionExpiredError extends ApiError {
  constructor(body?: unknown) {
    super(SESSION_EXPIRED_MESSAGE, 401, body);
  }
}

let sessionExpirationHandled = false;

export function getAuthToken() {
  return window.localStorage.getItem('zdm-admin-token');
}

export function setAuthToken(token: string) {
  sessionExpirationHandled = false;
  window.localStorage.setItem('zdm-admin-token', token);
}

export function clearAuthToken() {
  window.localStorage.removeItem('zdm-admin-token');
}

function clearExpiredLoginSession() {
  if (sessionExpirationHandled) return;
  sessionExpirationHandled = true;
  clearAuthToken();
  window.localStorage.removeItem('zdm-admin-user');
  window.dispatchEvent(new Event('zdm-auth-session-cleared'));
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body || body.code !== 0) {
    if (response.status === 401 && path !== '/admin/auth/login') {
      // A delayed response from an old session must not clear a newer login.
      if (getAuthToken() === token || !getAuthToken()) clearExpiredLoginSession();
      throw new SessionExpiredError(body);
    }
    throw new ApiError(body?.message ?? '请求失败', response.status, body);
  }

  return body.data;
}
