import { describe, expect, it } from 'vitest';
import { groupShelfFailures } from './operationsBatchShelf';
import { fullFunctionCatalog, normalizeFunctionCatalogPermissions } from './functionCatalog';
import { getLoginUser, setLoginUser } from './auth';
describe('operations batch shelf results and grants', () => {
  it('groups identical reasons without counting rows as failed products', () => {
    expect(
      groupShelfFailures([
        { id: 61, code: 'SOURCE', reason: '供应链已下架该商品' },
        { id: 62, code: 'VALIDATION_FAILED', reason: '供应链已下架该商品' },
        { id: 64, code: 'STATE', reason: '已处于上架状态，不能重复上架' },
      ]).map(({ productIds, reason }) => ({ productIds, reason })),
    ).toEqual([
      { productIds: '61、62', reason: '供应链已下架该商品' },
      { productIds: '64', reason: '已处于上架状态，不能重复上架' },
    ]);
  });
  for (const module of ['finished-stock-management', 'accessory-management', 'slab-management']) {
    it(`${module} registers one state grant shared by single and batch shelf`, () => {
      const prefix = `admin.${module}`;
      const page = fullFunctionCatalog
        .flatMap((m) => m.menus)
        .flatMap((m) => m.pages)
        .find((p) => p.value === prefix)!;
      expect(page.actions.filter((a) => a.value === `${prefix}.batch-shelf`)).toHaveLength(0);
      expect(page.tabs.flatMap((t) => t.actions).some((a) => a.value.endsWith('.batch-shelf'))).toBe(false);
      expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.batch-shelf`])).toEqual([
        `${prefix}.warehouse.view`,
        `${prefix}.warehouse.shelf`,
      ]);
      expect(normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.warehouse.batch-shelf`])).toEqual([
        `${prefix}.warehouse.view`,
        `${prefix}.warehouse.shelf`,
      ]);
      const previous = getLoginUser();
      try {
        setLoginUser({ ...previous, permissions: [`${prefix}.batch-shelf`] });
        expect(getLoginUser().permissions).toEqual([`${prefix}.warehouse.view`, `${prefix}.warehouse.shelf`]);
      } finally {
        setLoginUser(previous);
      }
    });
  }
});
