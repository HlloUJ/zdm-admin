import { describe, expect, it } from 'vitest';

import type { LoginUser } from './auth';
import {
  adminMenuEntries,
  getFirstAccessiblePath,
  hasMenuPermission,
  hasPermission,
  isSuperAdmin,
} from './adminPermissions';

function createUser(permissions: string[]): LoginUser {
  return {
    id: 12,
    name: '张飞',
    phone: '15900000001',
    roles: ['ADMIN_MANAGER'],
    permissions,
  };
}

describe('admin menu permissions', () => {
  it('shows the parent page when the user owns a descendant view permission', () => {
    const user = createUser(['admin.permission-management.role-management.view']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(true);
    expect(getFirstAccessiblePath(user)).toBe('/role-management');
  });

  it('does not infer page access from a mutating action without view', () => {
    const user = createUser(['admin.permission-management.role-management.permission']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(false);
    expect(getFirstAccessiblePath(user)).toBe('');
  });

  it('does not expose a sibling page', () => {
    const user = createUser(['admin.permission-management.employee-management.edit']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(false);
  });

  it('exposes store-category menu only with its view permission', () => {
    const viewUser = {
      ...createUser(['admin.tenant.store-category-management.view']),
      tenantId: 1,
      storeId: 1,
      storeType: 'cityPartner' as const,
    };
    const actionOnlyUser = createUser(['admin.tenant.store-category-management.create-root']);

    expect(hasMenuPermission(viewUser, 'admin.tenant.store-category-management')).toBe(true);
    expect(getFirstAccessiblePath(viewUser)).toBe('/store-category-management');
    expect(hasMenuPermission(actionOnlyUser, 'admin.tenant.store-category-management')).toBe(false);
    expect(getFirstAccessiblePath(actionOnlyUser)).toBe('');
  });

  it('places store levels below tenant store base data and keeps store categories direct', () => {
    const user = createUser(['admin.tenant.store-level-management.view']);
    expect(getFirstAccessiblePath(user)).toBe('/store-level-management');

    expect(adminMenuEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '门店分类管理', path: '/store-category-management' }),
        expect.objectContaining({
          label: '租户与门店',
          children: expect.arrayContaining([
            expect.objectContaining({
              label: '门店基础数据',
              children: [expect.objectContaining({ label: '门店级别管理', path: '/store-level-management' })],
            }),
          ]),
        }),
      ]),
    );
  });

  it('accepts legacy category enable and disable permissions for the merged toggle action', () => {
    expect(
      hasPermission(
        {
          ...createUser(['admin.tenant.store-category-management.disable']),
          tenantId: 1,
          storeId: 1,
          storeType: 'cityPartner',
        },
        'admin.tenant.store-category-management.toggle-status',
      ),
    ).toBe(true);
    expect(
      hasPermission(
        createUser(['admin.product-data-center.category.finished.enable']),
        'admin.product-data-center.category.finished.toggle-status',
      ),
    ).toBe(true);
  });

  it('keeps menus without a permission prefix hidden from regular users', () => {
    expect(hasMenuPermission(createUser([]))).toBe(false);
  });
});

describe('super administrator identity', () => {
  it('keeps all function permissions separate from super administrator status', () => {
    const user = { ...createUser(['all']), dataPermission: 'self' as const };
    expect(isSuperAdmin(user)).toBe(false);
    expect(hasPermission(user, 'admin.supplier-management.edit')).toBe(true);
    expect(hasMenuPermission(user, 'admin.supplier-management')).toBe(true);
  });

  it('recognizes a real super administrator without separately assigned functions', () => {
    const user = { ...createUser([]), roles: ['SUPER_ADMIN'] };
    expect(isSuperAdmin(user)).toBe(true);
    expect(hasPermission(user, 'admin.supplier-management.edit')).toBe(true);
  });
});

describe('function audience boundaries', () => {
  it('never exposes store categories to platform identities including super administrators', () => {
    for (const roles of [['SUPER_ADMIN'], ['ADMIN_MANAGER']]) {
      const user = { ...createUser(['all', 'admin.tenant.store-category-management.view']), roles };
      expect(hasMenuPermission(user, 'admin.tenant.store-category-management')).toBe(false);
      expect(hasPermission(user, 'admin.tenant.store-category-management.edit')).toBe(false);
    }
  });

  it.each(['cityPartner', 'slabSupplier', 'finishedSupplier'] as const)(
    'limits %s to shared and terminal functions',
    (storeType) => {
      const user = { ...createUser(['all']), tenantId: 1, storeId: 2, storeType };
      for (const prefix of [
        'admin.tenant.tenant-management',
        'admin.product-data-center.category',
        'admin.finished-stock-management',
        'admin.slab-management',
        'admin.permission-management.terminal-function-allocation',
      ]) {
        expect(hasMenuPermission(user, prefix)).toBe(false);
        expect(hasPermission(user, `${prefix}.edit`)).toBe(false);
      }
      expect(hasMenuPermission(user, 'admin.supplier-management')).toBe(true);
      expect(hasMenuPermission(user, 'admin.tenant.store-category-management')).toBe(true);
    },
  );
});
