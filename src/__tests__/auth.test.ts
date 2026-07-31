import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLoginUser, login, logout } from '@/services/auth';

describe('auth service', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores the logged-in user with the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            message: 'ok',
            data: {
              token: 'opaque-session-token',
              user: {
                id: 2,
                name: '测试员工',
                phone: '15900000001',
                roles: ['OPERATION_MANAGER'],
                permissions: [
                  'admin.permission-management.employee-management.query',
                  'admin.permission-management.employee-management.reset',
                  'admin.permission-management.employee-management.edit',
                ],
              },
            },
          }),
      }),
    );

    await login({ phone: '15900000001', verifyCode: '888888' });

    expect(window.localStorage.getItem('zdm-admin-token')).toBe('opaque-session-token');
    expect(getLoginUser()).toMatchObject({
      id: 2,
      name: '测试员工',
      phone: '15900000001',
      permissions: [
        'admin.permission-management.employee-management.view',
        'admin.permission-management.employee-management.edit',
      ],
    });
  });

  it('revokes and clears the stored login session on logout', async () => {
    window.localStorage.setItem('zdm-admin-token', 'opaque-session-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 2,
        name: '测试员工',
        phone: '15900000001',
        roles: ['OPERATION_MANAGER'],
        permissions: [],
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, message: 'ok', data: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Headers),
      }),
    );
    expect(window.localStorage.getItem('zdm-admin-token')).toBeNull();
    expect(window.localStorage.getItem('zdm-admin-user')).toBeNull();
  });

  it('clears local state when the backend rejects logout', async () => {
    window.localStorage.setItem('zdm-admin-token', 'expired-session-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({ id: 2, name: '测试员工', phone: '15900000001', roles: [], permissions: [] }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ code: 401, message: '未登录', data: null }),
      }),
    );

    await expect(logout()).resolves.toBeUndefined();

    expect(window.localStorage.getItem('zdm-admin-token')).toBeNull();
    expect(window.localStorage.getItem('zdm-admin-user')).toBeNull();
    expect(getLoginUser().roles).toContain('SUPER_ADMIN');
  });
});
