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
              token: 'dev-token:2',
              user: {
                id: 2,
                name: '测试员工',
                phone: '15900000001',
                roles: ['OPERATION_MANAGER'],
                permissions: ['admin.permission.employee-management.view'],
              },
            },
          }),
      }),
    );

    await login({ phone: '15900000001', verifyCode: '888888' });

    expect(window.localStorage.getItem('zdm-admin-token')).toBe('dev-token:2');
    expect(getLoginUser()).toMatchObject({
      id: 2,
      name: '测试员工',
      phone: '15900000001',
    });
  });

  it('clears the stored login session on logout', () => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token:2');
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

    logout();

    expect(window.localStorage.getItem('zdm-admin-token')).toBeNull();
    expect(window.localStorage.getItem('zdm-admin-user')).toBeNull();
  });
});
