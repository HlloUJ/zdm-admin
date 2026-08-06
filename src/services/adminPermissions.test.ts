import { describe, expect, it } from 'vitest';

import type { LoginUser } from './auth';
import { getFirstAccessiblePath, hasMenuPermission, hasPermission } from './adminPermissions';

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
    const user = createUser(['admin.permission-management.role-management.operation-platform.view']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(true);
    expect(getFirstAccessiblePath(user)).toBe('/role-management');
  });

  it('does not infer page access from a mutating action without view', () => {
    const user = createUser(['admin.permission-management.role-management.operation-platform.permission']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(false);
    expect(getFirstAccessiblePath(user)).toBe('');
  });

  it('does not expose a sibling page', () => {
    const user = createUser(['admin.permission-management.employee-management.edit']);

    expect(hasMenuPermission(user, 'admin.permission-management.role-management')).toBe(false);
  });

  it('exposes store-category menu only with its view permission', () => {
    const viewUser = createUser(['admin.tenant.store-category-management.view']);
    const actionOnlyUser = createUser(['admin.tenant.store-category-management.create-root']);

    expect(hasMenuPermission(viewUser, 'admin.tenant.store-category-management')).toBe(true);
    expect(getFirstAccessiblePath(viewUser)).toBe('/store-category-management');
    expect(hasMenuPermission(actionOnlyUser, 'admin.tenant.store-category-management')).toBe(false);
    expect(getFirstAccessiblePath(actionOnlyUser)).toBe('');
  });

  it('accepts legacy category enable and disable permissions for the merged toggle action', () => {
    expect(
      hasPermission(
        createUser(['admin.tenant.store-category-management.disable']),
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
