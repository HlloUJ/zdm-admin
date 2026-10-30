import { describe, expect, it, vi } from 'vitest';
import { shelfProductsFromAll } from './productAllBatchShelf';
import { request } from './http';
vi.mock('./http', () => ({ request: vi.fn() }));
import { fullFunctionCatalog, normalizeFunctionCatalogPermissions, terminalFunctionTrees } from './functionCatalog';
import { expandLegacyProductGlobalPermission, isProductGlobalAction } from './productGlobalPermissions';
import { getLoginUser, setLoginUser } from './auth';
const prefixes = [
  'supply-chain.finished-stock-management',
  'supply-chain.accessory-management',
  'supply-chain.slab-management',
  'store.finished-stock-management',
  'store.accessory-management',
];
describe('terminal All batch permissions', () => {
  for (const prefix of prefixes)
    it(prefix + ' has one global batch grant and preserves the legacy warehouse grant only', () => {
      const terminal = prefix.startsWith('store.') ? 'store' : 'supply-chain';
      const page = terminalFunctionTrees[terminal]
        .flatMap((m) => m.menus)
        .flatMap((m) => m.pages)
        .find((p) => p.value === prefix)!;
      expect(page.actions.filter((a) => a.value === prefix + '.batch-shelf')).toEqual([
        { label: '批量上架', value: prefix + '.batch-shelf' },
      ]);
      expect(page.tabs.flatMap((t) => t.actions).some((a) => a.value.endsWith('.batch-shelf'))).toBe(false);
      expect(page.tabs[0].actions).toEqual([{ label: '查看', value: prefix + '.all.view' }]);
      expect(isProductGlobalAction(prefix + '.batch-shelf')).toBe(true);
      expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [prefix + '.batch-shelf'])).toEqual([
        prefix + '.batch-shelf',
      ]);
      expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [prefix + '.warehouse.batch-shelf'])).toEqual([
        prefix + '.batch-shelf',
        prefix + '.warehouse.view',
      ]);
      expect(expandLegacyProductGlobalPermission(prefix + '.warehouse.batch-shelf')).toEqual([
        prefix + '.warehouse.batch-shelf',
        prefix + '.warehouse.view',
        prefix + '.batch-shelf',
      ]);
      const previous = getLoginUser();
      try {
        setLoginUser({ ...previous, permissions: [prefix + '.batch-shelf'] });
        expect(getLoginUser().permissions).toEqual([prefix + '.batch-shelf']);
      } finally {
        setLoginUser(previous);
      }
    });
  it('does not add a store slab action or alter unrelated operations', () => {
    expect(isProductGlobalAction('store.slab-management.batch-shelf')).toBe(false);
    expect(
      expandLegacyProductGlobalPermission('store.finished-stock-management.selling.batch-off-shelf'),
    ).toBeUndefined();
  });
});

it('uses record IDs for the API and preserves displayed IDs for missing or failed store records', async () => {
  vi.mocked(request).mockResolvedValueOnce({
    total: 2,
    successCount: 0,
    failureCount: 2,
    failures: [
      { id: 71, code: 'NOT_ACCESSIBLE', reason: '商品不存在或无权操作' },
      { id: 72, code: 'VALIDATION_FAILED', reason: '已处于上架状态，不能重复上架' },
    ],
  });
  const result = await shelfProductsFromAll('store-finished-products', [71, 72], { 71: 1071, 72: 1072 });
  expect(request).toHaveBeenLastCalledWith('/admin/store-finished-products/all-batch-shelf', {
    method: 'POST',
    body: JSON.stringify({ ids: [71, 72] }),
  });
  expect(result.failures.map((failure) => failure.id)).toEqual([1071, 1072]);
});
