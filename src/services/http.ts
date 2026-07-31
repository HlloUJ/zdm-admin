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

export function getAuthToken() {
  return window.localStorage.getItem('zdm-admin-token');
}

export function setAuthToken(token: string) {
  window.localStorage.setItem('zdm-admin-token', token);
}

export function clearAuthToken() {
  window.localStorage.removeItem('zdm-admin-token');
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
    throw new ApiError(body?.message ?? '请求失败', response.status, body);
  }

  return body.data;
}
