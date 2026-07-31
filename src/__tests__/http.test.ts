import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request } from '@/services/http';

describe('request', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
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
