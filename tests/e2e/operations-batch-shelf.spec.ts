import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';
const surfaces = [
  { path: '/finished-stock-management', resource: 'finished-products' },
  { path: '/accessory-management', resource: 'accessory-products' },
  { path: '/slab-management', resource: 'slabs' },
] as const;
for (const surface of surfaces)
  for (const tab of ['all', 'warehouse']) {
    test(`${surface.path} ${tab} uses one batch request, grouped failures and refreshed invalidation masks`, async ({
      page,
    }) => {
      await (surface.resource === 'accessory-products' ? installAccessoryApiMocks : installAdminApiMocks)(page);
      if (surface.resource !== 'slabs') {
        for (const option of ['attribute-template-options', 'price-level-options'])
          await page.route(`**/api/admin/${surface.resource}/${option}`, (route) =>
            route.fulfill({ json: { code: 0, data: [] } }),
          );
      }
      const prefix = `admin.${surface.path.slice(1)}`;
      await page.addInitScript(
        ({ prefix }) => {
          localStorage.setItem('zdm-admin-token', 'dev-token');
          localStorage.setItem(
            'zdm-admin-user',
            JSON.stringify({
              id: 1,
              name: '运营批量测试',
              clientCode: 'admin',
              roles: ['OPERATOR'],
              permissions: [
                `${prefix}.all.view`,
                `${prefix}.warehouse.view`,
                `${prefix}.selling.view`,
                `${prefix}.batch-shelf`,
              ],
              dataPermission: 'all',
            }),
          );
        },
        { prefix },
      );
      const products = [71, 72, 73, 74, 75].map((id) => ({
        id,
        name: `批量商品${id}`,
        status: id === 72 ? 'selling' : 'warehouse',
        sourceStatus: 'selling',
        sourceUnavailable: false,
        sourceMessage: '',
        createdAt: `2026-10-30T09:${id - 60}:00`,
        totalStock: 2,
        stock: 2,
        attributes: [],
        variants: [],
        offShelfRecords: [],
        specDimensions: [],
      }));
      await page.route(`**/api/admin/${surface.resource}`, (route) =>
        route.fulfill({ json: { code: 0, data: products } }),
      );
      let requests = 0;
      await page.route(`**/api/admin/${surface.resource}/batch-shelf`, (route) => {
        requests++;
        const ids = route.request().postDataJSON().ids as number[];
        expect(new Set(ids)).toEqual(new Set(tab === 'all' ? [71, 72, 73, 74, 75] : [71, 73, 74, 75]));
        products.find((p) => p.id === 71)!.status = 'selling';
        for (const id of [73, 75])
          Object.assign(
            products.find((p) => p.id === id)!,
            { sourceStatus: 'warehouse', sourceUnavailable: true, sourceMessage: '该商品已被供应链下架' },
          );
        const failures = ids
          .filter((id) => id !== 71)
          .map((id) => ({
            id,
            code: 'VALIDATION_FAILED',
            reason:
              id === 72
                ? '已处于上架状态，不能重复上架'
                : id === 74
                  ? '缺少指导价配置，无法上架'
                  : '该商品已被供应链下架',
          }));
        return route.fulfill({
          json: { code: 0, data: { total: ids.length, successCount: 1, failureCount: failures.length, failures } },
        });
      });
      await page.goto(`${surface.path}?tab=${tab}`);
      const main = page.getByRole('main');
      const batch = main.getByRole('button', { name: '批量上架', exact: true });
      await expect(batch).toBeDisabled();
      await expect(main.locator('tbody tr')).toHaveCount(tab === 'all' ? 5 : 4);
      await main.locator('thead .t-checkbox__input').click();
      await batch.click();
      await page.locator('.t-dialog:visible').getByRole('button', { name: '确认批量上架', exact: true }).click();
      const result = page.locator('.t-dialog:visible').filter({ hasText: '批量上架结果' });
      await expect(result).toContainText(`成功上架1件，失败${tab === 'all' ? 4 : 3}件。`);
      await expect(result.getByRole('columnheader')).toHaveText(['商品ID', '失败原因']);
      const sourceFailure = result.getByRole('row').filter({ hasText: '该商品已被供应链下架' });
      await expect(sourceFailure).toHaveCount(1);
      await expect(sourceFailure).toContainText('73');
      await expect(sourceFailure).toContainText('75');
      await expect(result).toContainText('缺少指导价配置，无法上架');
      if (tab === 'all') await expect(result).toContainText('已处于上架状态，不能重复上架');
      expect(requests).toBe(1);
      await result.getByRole('button', { name: '确认', exact: true }).click();
      await expect(result).toBeHidden();
      await expect(main.locator('.source-unavailable-overlay')).toHaveCount(2);
      await expect(main.locator('.source-unavailable-overlay').first()).toContainText('该商品已被供应链下架');
      await expect(main.locator('tbody input[type="checkbox"]:checked')).toHaveCount(0);
      await expect(batch).toBeDisabled();
      expect(requests).toBe(1);
    });
  }
