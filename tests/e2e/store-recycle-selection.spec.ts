import { expect, test } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { installAdminApiMocks as installAccessoryApiMocks } from './accessory-api-mocks';

for (const [kind, path] of [
  ['finished', '/store/finished-stock-management'],
  ['accessory', '/store/accessory-management'],
] as const) {
  for (const batchPurge of [false, true]) {
    test(`store ${kind} recycle selection count requires a selected-item batch action; batch purge=${batchPurge}`, async ({
      page,
    }) => {
      await (kind === 'accessory' ? installAccessoryApiMocks : installAdminApiMocks)(page);
      const module = kind === 'finished' ? 'finished-stock-management' : 'accessory-management';
      const resource = `store-${kind}-products`;
      await page.addInitScript(
        ({ module, batchPurge }) => {
          const prefix = `store.${module}.recycle`;
          localStorage.setItem('zdm-admin-token', 'dev-token');
          localStorage.setItem(
            'zdm-admin-user',
            JSON.stringify({
              id: 7,
              name: '回收站受限员工',
              clientCode: 'admin',
              tenantId: 1,
              storeId: 2,
              storeType: 'cityPartner',
              roles: ['OPERATOR'],
              dataPermission: 'all',
              permissions: [`${prefix}.view`, `${prefix}.clear`, ...(batchPurge ? [`${prefix}.purge`] : [])],
            }),
          );
        },
        { module, batchPurge },
      );
      let writes = 0;
      await page.route(`**/api/admin/${resource}**`, (route) => {
        if (route.request().method() !== 'GET') writes++;
        return route.fulfill({
          json: {
            code: 0,
            data: new URL(route.request().url()).pathname.endsWith('/categories')
              ? []
              : [
                  {
                    id: 41,
                    productId: 91,
                    name: '回收站选择测试商品',
                    status: 'recycle',
                    effectiveStatus: 'recycle',
                    sourceUnavailable: false,
                    totalStock: 3,
                    imageUrls: [],
                    attributes: [],
                    skus: [],
                  },
                ],
          },
        });
      });
      await page.goto(`${path}?tab=recycle`);
      const main = page.getByRole('main');
      await expect(main.locator('tbody tr')).toHaveCount(1);
      const clear = main.getByRole('button', { name: '清空回收站', exact: true });
      await expect(clear).toBeEnabled();
      await expect(main.getByText('已选 1 项', { exact: true })).toHaveCount(0);
      if (batchPurge) {
        await main.locator('thead .t-checkbox__input').click();
        await expect(main.locator('tbody input[type="checkbox"]:checked')).toHaveCount(1);
      } else {
        await expect(main.getByRole('checkbox')).toHaveCount(0);
      }
      await expect(main.getByText('已选 1 项', { exact: true })).toHaveCount(batchPurge ? 1 : 0);
      const purge = main.getByRole('button', { name: '批量彻底删除', exact: true });
      if (batchPurge) await expect(purge).toBeEnabled();
      else await expect(purge).toHaveCount(0);
      await clear.click();
      const dialog = page.locator('.t-dialog:visible');
      await expect(dialog.getByText('是否清空回收站？', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      expect(writes).toBe(0);
      await expect(main.getByText('已选 1 项', { exact: true })).toHaveCount(batchPurge ? 1 : 0);
    });
  }
}
