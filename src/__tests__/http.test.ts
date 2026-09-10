import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request, setAuthToken, SESSION_EXPIRED_MESSAGE } from '@/services/http';

describe('request', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    setAuthToken('test-session');
  });

  it('returns response data for successful API responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ code: 0, message: 'ok', data: { id: 1 } }),
      }),
    );

    await expect(request('/tenants')).resolves.toEqual({ id: 1 });
  });

  it('throws ApiError for business errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 400, message: '验证码错误', data: null }),
      }),
    );

    await expect(request('/auth/login')).rejects.toBeInstanceOf(ApiError);
  });

  it('clears an expired session and emits one event for concurrent unauthorized responses', async () => {
    const listener = vi.fn();
    window.addEventListener('zdm-auth-session-cleared', listener);
    window.localStorage.setItem('zdm-admin-user', '{}');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.reject(new Error('empty response')),
      }),
    );
    try {
      const results = await Promise.allSettled([request('/admin/slabs/48'), request('/admin/slabs/49')]);
      results.forEach((result) => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason.message).toBe(SESSION_EXPIRED_MESSAGE);
      });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem('zdm-admin-token')).toBeNull();
      expect(window.localStorage.getItem('zdm-admin-user')).toBeNull();
    } finally {
      window.removeEventListener('zdm-auth-session-cleared', listener);
    }
  });

  it('preserves login error messages and does not expire a newer session', async () => {
    const listener = vi.spyOn(window, 'dispatchEvent');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        setAuthToken('new-session');
        return { ok: false, status: 401, json: async () => ({ message: '验证码错误' }) };
      }),
    );
    await expect(request('/admin/auth/login')).rejects.toThrow('验证码错误');
    setAuthToken('old-session');
    await expect(request('/admin/slabs/48')).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(window.localStorage.getItem('zdm-admin-token')).toBe('new-session');
    expect(listener).not.toHaveBeenCalled();
  });

  it('lets the browser set multipart boundaries for form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, message: 'ok', data: { url: '/image.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const body = new FormData();
    body.append('file', new File(['image'], 'craft.png', { type: 'image/png' }));

    await request('/admin/crafts/images', { method: 'POST', body });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.has('Content-Type')).toBe(false);
  });
});
