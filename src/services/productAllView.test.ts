import { hasMenuPermission } from './adminPermissions';
import type { LoginUser } from './auth';
import { describe, expect, it } from 'vitest';
import {
  initialProductListTab,
  isAllProductStatus,
  productCreationColumns,
  sortProductsByCreation,
} from './productAllView';
import {
  fullFunctionCatalog,
  getFunctionCatalogPermissionValues,
  normalizeFunctionCatalogPermissions,
} from './functionCatalog';

describe('product All view', () => {
  it('keeps real statuses separate from query views and rejects unknown route values', () => {
    expect(['warehouse', 'selling', 'soldOut', 'recycle', 'all'].filter(isAllProductStatus)).toEqual([
      'warehouse',
      'selling',
    ]);
    expect(initialProductListTab(undefined)).toBe('all');
    expect(initialProductListTab('warehouse')).toBe('warehouse');
    expect(initialProductListTab('invalid')).toBe('all');
    expect(productCreationColumns.map((column) => column.title)).toEqual(['创建人', '创建时间']);
  });
  it('sorts only by creation descending without IDs, state times or mutations', () => {
    const rows = [
      { id: 1, createdAt: '2026-10-01' },
      { id: 99, createdAt: '2026-10-01' },
      { id: 2, createdAt: '2026-10-02' },
      { id: 3, stateOperatedAt: '2027-01-01' },
    ];
    expect(sortProductsByCreation(rows).map((row) => row.id)).toEqual([2, 1, 99, 3]);
    expect(rows.map((row) => row.id)).toEqual([1, 99, 2, 3]);
  });
  it('registers only the eight real pages, references existing operations and does not auto-grant All', () => {
    const pages = fullFunctionCatalog
      .flatMap((module) => module.menus)
      .flatMap((menu) => menu.pages)
      .filter(
        (page) =>
          page.tabs.some((tab) => tab.value === `${page.value}.all`) &&
          /(?:finished-stock|accessory|slab)-management$/.test(page.value),
      );
    expect(pages.map((page) => page.value).sort()).toEqual(
      [
        'admin.finished-stock-management',
        'admin.accessory-management',
        'admin.slab-management',
        'supply-chain.finished-stock-management',
        'supply-chain.accessory-management',
        'supply-chain.slab-management',
        'store.finished-stock-management',
        'store.accessory-management',
      ].sort(),
    );
    for (const page of pages) {
      const all = page.tabs[0];
      expect(all.label).toBe('全部');
      expect(all.actions[0]).toEqual({ label: '查看', value: `${page.value}.all.view` });
      expect(
        all.actions
          .slice(1)
          .every((action) => /\.(warehouse|selling)\.(publish|select|shelf|off-shelf|edit|delete)$/.test(action.value)),
      ).toBe(true);
      const module = fullFunctionCatalog.find((module) =>
        module.menus.some((menu) => menu.pages.some((candidate) => candidate.value === page.value)),
      )!;
      expect(normalizeFunctionCatalogPermissions([module], [`${page.value}.warehouse.edit`])).not.toContain(
        `${page.value}.all.view`,
      );
      expect(getFunctionCatalogPermissionValues([module])).toContain(`${page.value}.all.view`);
    }
  });
});

it('an isolated All grant never reveals an empty product menu while existing state and log entries remain valid', () => {
  for (const client of ['admin', 'supply-chain', 'store'] as const) {
    for (const module of [
      'finished-stock-management',
      'accessory-management',
      ...(client === 'store' ? [] : ['slab-management']),
    ]) {
      const prefix = `${client}.${module}`;
      const user: LoginUser = {
        id: 1,
        name: '受限用户',
        phone: '',
        roles: ['OPERATOR'],
        permissions: [`${prefix}.all.view`],
        clientCode: client === 'store' ? 'admin' : client,
        ...(client === 'store' ? { tenantId: 1, storeId: 2, storeType: 'cityPartner' as const } : {}),
      };
      expect(hasMenuPermission(user, prefix)).toBe(false);
      expect(
        hasMenuPermission({ ...user, permissions: [...user.permissions, `${prefix}.warehouse.view`] }, prefix),
      ).toBe(true);
      expect(hasMenuPermission({ ...user, permissions: [`${prefix}.operation-log.view`] }, prefix)).toBe(true);
    }
  }
});
