import { getLoginUser, setLoginUser } from './auth';
import { describe, expect, it } from 'vitest';
import {
  fullFunctionCatalog,
  collectFunctionCatalogRows,
  getRowViewPermissionValue,
  normalizeFunctionCatalogPermissions,
  terminalFunctionTrees,
  filterFunctionCatalogByPermissions,
} from './functionCatalog';
import { expandLegacyScopedPermission } from './functionPermissionCompatibility';
import { isProductGlobalAction } from './productGlobalPermissions';

const pages = fullFunctionCatalog.flatMap((m) => m.menus).flatMap((m) => m.pages);
const globals = [
  ...['finished-stock-management', 'accessory-management', 'slab-management'].map((m) => [
    `supply-chain.${m}`,
    'publish',
    '发布商品',
  ]),
  ...['finished-stock-management', 'accessory-management'].map((m) => [`store.${m}`, 'select', '商品中心']),
];
describe('product global entry permissions', () => {
  for (const [prefix, action, label] of globals) {
    it(`${prefix} configures ${action} once without granting views, logs or state actions`, () => {
      const page = pages.find((p) => p.value === prefix)!;
      expect(page.actions).toEqual([
        { label, value: `${prefix}.${action}` },
        { label: '批量上架', value: `${prefix}.batch-shelf` },
        { label: '操作日志', value: `${prefix}.operation-log.view` },
      ]);
      expect(page.tabs[0].actions).toEqual([{ label: '查看', value: `${prefix}.all.view` }]);
      expect(page.tabs.flatMap((t) => t.actions).some((a) => a.value.endsWith(`.${action}`))).toBe(false);
      expect(isProductGlobalAction(`${prefix}.${action}`)).toBe(true);
      const previous = getLoginUser();
      try {
        setLoginUser({ ...previous, permissions: [`${prefix}.${action}`] });
        expect(getLoginUser().permissions).toEqual([`${prefix}.${action}`]);
      } finally {
        setLoginUser(previous);
      }
      expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.${action}`])).toEqual([
        `${prefix}.${action}`,
      ]);
      const module = fullFunctionCatalog.find((m) => m.menus.some((menu) => menu.pages.includes(page)))!;
      const row = collectFunctionCatalogRows(module).find((r) =>
        r.actions.some((a) => a.value === `${prefix}.${action}`),
      )!;
      expect(getRowViewPermissionValue(row)).toBeUndefined();
      expect(
        normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.${action}`, `${prefix}.warehouse.edit`]),
      ).toEqual([`${prefix}.${action}`, `${prefix}.warehouse.view`, `${prefix}.warehouse.edit`]);
      const terminal = prefix.startsWith('store.') ? 'store' : 'supply-chain';
      const filtered = filterFunctionCatalogByPermissions(terminalFunctionTrees[terminal], [`${prefix}.${action}`]);
      expect(
        filtered
          .flatMap((m) => m.menus)
          .flatMap((m) => m.pages)
          .flatMap((p) => p.actions)
          .map((a) => a.value),
      ).toEqual([`${prefix}.${action}`]);
      for (const scope of action === 'publish' ? ['warehouse', 'selling'] : ['warehouse']) {
        expect(expandLegacyScopedPermission(`${prefix}.${scope}.${action}`)).toEqual([
          `${prefix}.${scope}.view`,
          `${prefix}.${action}`,
        ]);
        expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.${scope}.${action}`])).toEqual([
          `${prefix}.${action}`,
          `${prefix}.${scope}.view`,
        ]);
      }
    });
  }
  it('does not globalize state edits or unrelated operations', () => {
    expect(expandLegacyScopedPermission('supply-chain.slab-management.selling.edit')).toEqual([
      'supply-chain.slab-management.selling.edit',
    ]);
    expect(isProductGlobalAction('admin.slab-management.publish')).toBe(false);
    expect(isProductGlobalAction('store.slab-management.select')).toBe(false);
  });
});
