import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
async function setup(page: Page, grants: string[], extendedTree = false) {
  await installAdminApiMocks(page);
  await page.addInitScript(
    (permissions) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          clientCode: 'admin',
          name: '测试员工',
          roles: ['EMPLOYEE'],
          tenantId: 1,
          storeId: 1,
          storeType: 'cityPartner',
          dataPermission: 'self',
          permissions,
        }),
      );
    },
    grants.map((grant) => `store.price-configuration.${grant}`),
  );
  const requests: { method: string; path: string; scope: string | null; body: unknown }[] = [];
  const priceRules = [
    { id: 1, scope: 'finished', categoryId: 11, roleId: null, targetName: '本店餐桌', coefficient: 9 },
    { id: 2, scope: 'finished', categoryId: 12, roleId: null, targetName: '石材餐桌', coefficient: 2 },
  ];
  const discounts: {
    id: number;
    scope: string;
    categoryId: null;
    roleId: number;
    targetName: string;
    coefficient: number;
    status?: string;
    createdByName?: string;
    createdAt?: string;
  }[] = ['finished', 'accessory'].map((scope) => ({
    id: 7,
    scope,
    categoryId: null,
    roleId: 7,
    targetName: '店长',
    status: 'enabled',
    createdByName: '测试员工',
    createdAt: '2026-10-10T10:05:00',
    coefficient: scope === 'finished' ? 0.8 : 0.9,
  }));
  await page.route('**/api/admin/store-price-rules/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const scope = url.searchParams.get('scope');
    requests.push({ method: route.request().method(), path, scope, body: route.request().postDataJSON() });
    let data: unknown = [];
    const discountId = Number(path.match(/\/discount\/(\d+)/)?.[1]);
    if (discountId && ['PUT', 'DELETE'].includes(route.request().method())) {
      const index = discounts.findIndex((rule) => rule.id === discountId && rule.scope === scope);
      const body = route.request().postDataJSON();
      if (route.request().method() === 'DELETE') discounts.splice(index, 1);
      else if (path.endsWith('/status')) discounts[index].status = body.status;
      else {
        discounts[index].coefficient = body.coefficient;
        discounts[index].roleId = body.roleId;
      }
      data = discounts.filter((rule) => rule.scope === scope);
    } else if (path.endsWith('/discount') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      discounts.push({
        id: body.roleId,
        scope: scope!,
        categoryId: null,
        roleId: body.roleId,
        targetName: '导购',
        coefficient: body.coefficient,
      });
      data = discounts.filter((rule) => rule.scope === scope);
    } else if (path.endsWith('/price/save')) {
      const body = route.request().postDataJSON();
      for (const change of body.changes) {
        const index = priceRules.findIndex((rule) => rule.scope === scope && rule.categoryId === change.categoryId);
        if (change.coefficient == null) {
          if (index >= 0) priceRules.splice(index, 1);
        } else if (index >= 0) priceRules[index].coefficient = change.coefficient;
        else
          priceRules.push({
            id: change.categoryId,
            categoryId: change.categoryId,
            roleId: null,
            scope: scope!,
            targetName: '',
            coefficient: change.coefficient,
          });
      }
      data = priceRules.filter((rule) => rule.scope === scope);
    } else if (path.endsWith('/price/batch-clear')) {
      const body = route.request().postDataJSON();
      for (let index = priceRules.length - 1; index >= 0; index--) {
        if (priceRules[index].scope === scope && body.targetIds.includes(priceRules[index].categoryId))
          priceRules.splice(index, 1);
      }
      data = priceRules.filter((rule) => rule.scope === scope);
    } else if (path.endsWith('/price/batch')) {
      const body = route.request().postDataJSON();
      for (const id of body.targetIds) {
        const existing = priceRules.find((rule) => rule.scope === scope && rule.categoryId === id);
        if (existing) existing.coefficient = body.coefficient;
        else
          priceRules.push({
            id,
            scope: scope!,
            categoryId: id,
            roleId: null,
            targetName: '',
            coefficient: body.coefficient,
          });
      }
      data = priceRules.filter((rule) => rule.scope === scope);
    } else if (path.endsWith('/categories'))
      data =
        scope === 'finished'
          ? [
              {
                id: 11,
                parentId: null,
                scope,
                name: '本店餐桌',
                status: 'enabled',
              },
              {
                id: 12,
                parentId: 11,
                scope,
                name: '石材餐桌',
                status: 'enabled',
              },
              { id: 14, parentId: 11, scope, name: '木质餐桌', status: 'enabled' },
              ...(extendedTree
                ? [
                    { id: 15, parentId: 11, scope, name: '深层分类', status: 'enabled' },
                    { id: 16, parentId: 15, scope, name: '深层末级分类', status: 'enabled' },
                    { id: 21, parentId: null, scope, name: '另一一级分类', status: 'enabled' },
                    { id: 22, parentId: 21, scope, name: '另一二级分类', status: 'enabled' },
                    { id: 23, parentId: 22, scope, name: '另一末级甲', status: 'enabled' },
                    { id: 24, parentId: 22, scope, name: '另一末级乙', status: 'enabled' },
                  ]
                : []),
            ]
          : [
              {
                id: 13,
                parentId: null,
                scope,
                name: '未配置配件',
                status: 'enabled',
              },
            ];
    else if (path.endsWith('/roles'))
      data = [
        { id: 7, name: '店长', status: 'enabled' },
        { id: 8, name: '导购', status: 'enabled' },
      ];
    else if (path.endsWith('/price')) data = priceRules.filter((rule) => rule.scope === scope);
    else if (path.endsWith('/discount')) data = discounts.filter((rule) => rule.scope === scope);
    await route.fulfill({ json: { code: 0, message: 'ok', data } });
  });
  return requests;
}
const menu = (page: Page) => page.locator('.price-menu');
test('category list has only explicit coefficients and no derived values or maintenance actions', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view']);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-menu-group .t-menu__item')).toHaveText(['成品现货']);
  await expect(page.locator('thead th')).toHaveText(['分类名称', '价格系数']);
  const parent = page.getByRole('row').filter({ hasText: '本店餐桌' });
  await expect(parent.locator('.t-input-number')).toHaveCount(0);
  await expect(page.getByText('石材餐桌', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('input')).toHaveValue('2.00');
  await expect(page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('input')).toBeDisabled();
  await expect(page.getByText(/正常售价 =|未设置价格系数的分类|成品现货 ·/)).toHaveCount(0);
  await expect(page.getByText('说明', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/继承本店餐桌/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批量设置' })).toHaveCount(0);
  await expect(page.getByText('设置', { exact: true })).toHaveCount(0);
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test('price batch fills selected inputs locally and only Save writes configuration', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set']);
  await page.goto('/store/price-configuration');
  const batch = page.getByRole('button', { name: '批量设置', exact: true });
  await expect(page.getByRole('row').filter({ hasText: '本店餐桌' })).toBeVisible();
  await batch.click();
  await expect(page.getByText('请先选择分类', { exact: true })).toBeVisible();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '本店餐桌' }).getByRole('checkbox')).toBeEnabled();
  await page.locator('thead .t-checkbox').click();
  await batch.click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.t-dialog__header-content')).toHaveText('批量设置');
  await expect(dialog.getByText(/已选分类|已选择.*个分类|留空将/)).toHaveCount(0);
  await dialog.locator('.t-input-number input').fill('2.2');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const input of await page.locator('tbody .t-input-number input').all()) await expect(input).toHaveValue('2.20');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/price/save',
    scope: 'finished',
    body: {
      changes: [
        { categoryId: 12, coefficient: 2.2 },
        { categoryId: 14, coefficient: 2.2 },
      ],
    },
  });
});

test('role batch stores discount only for the selected role and product type', async ({ page }) => {
  const requests = await setup(page, [
    'discount.finished.view',
    'discount.accessory.view',
    'discount.accessory.batch-set',
  ]);
  await page.goto('/store/price-configuration');
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.80', { exact: true })).toBeVisible();
  await menu(page).locator('.t-menu-group .t-menu__item').filter({ hasText: '配件' }).click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.locator('thead th')).toHaveText(['', '角色', '折扣系数', '创建人', '创建时间']);
  await expect(page.getByText('导购', { exact: true })).toHaveCount(0);
  await page.getByRole('row').filter({ hasText: '店长' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量设置' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText(/已选择 1 个角色/)).toBeVisible();
  await dialog.locator('.t-input-number input').fill('1.2');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog.getByText('请输入0.01至1.00之间的折扣系数，最多两位小数', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await dialog.locator('.t-input-number input').click();
  await dialog.locator('.t-input-number input').fill('1.00');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/discount/batch',
    scope: 'accessory',
    body: { targetIds: [7], coefficient: 1 },
  });
});

test('product menus isolate categories and view-only role coefficients', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.accessory.view', 'discount.accessory.view']);
  await page.goto('/store/price-configuration');
  await menu(page).locator('.t-menu-group .t-menu__item').filter({ hasText: '配件' }).first().click();
  await expect(page.getByRole('row').filter({ hasText: '未配置配件' })).toBeVisible();
  await expect(page.getByText('石材餐桌', { exact: true })).toHaveCount(0);
  await menu(page).locator('.t-menu-group .t-menu__item').filter({ hasText: '配件' }).last().click();
  await expect(page.getByRole('row').filter({ hasText: '店长' }).getByText('0.90', { exact: true })).toBeVisible();
  await expect(page.locator('thead input[type=checkbox]')).toHaveCount(0);
  expect(requests.every((request) => request.method === 'GET')).toBe(true);
});

test('historical unscoped grants do not grant the product-specific settings', async ({ page }) => {
  const requests = await setup(page, ['view', 'create', 'price.view', 'discount.view']);
  await page.goto('/store/price-configuration');
  await expect(page).not.toHaveURL(/store\/price-configuration$/);
  expect(requests).toHaveLength(0);
});

test('query and reset preserve drafts; blur never saves and mixed edits save together', async ({ page }) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set']);
  await page.goto('/store/price-configuration');
  const parent = page.getByRole('row').filter({ hasText: '本店餐桌' });
  const firstLeaf = page.getByRole('row').filter({ hasText: '石材餐桌' });
  const input = firstLeaf.locator('input:not([type=checkbox])');
  await expect(input).toHaveValue('2.00');
  await input.fill('1000');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(firstLeaf.getByText('请输入0.01至999之间的系数，最多两位小数')).toBeVisible();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await input.fill('');
  const child = page.getByRole('row').filter({ hasText: '木质餐桌' });
  await child.locator('input:not([type=checkbox])').fill('1.8');
  await child.locator('input:not([type=checkbox])').press('e');
  await child.locator('input:not([type=checkbox])').press('-');
  const search = page.getByPlaceholder('请输入分类名称');
  await search.fill('不存在');
  await expect(child).toBeVisible();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(parent).toHaveCount(0);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(child.locator('input:not([type=checkbox])')).toHaveValue('1.80');
  await parent.getByRole('button', { name: '收起下级分类' }).click();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/price/save',
    scope: 'finished',
    body: {
      changes: [
        { categoryId: 12, coefficient: null },
        { categoryId: 14, coefficient: 1.8 },
      ],
    },
  });
});

test('failed save retains draft for retry and product switching preserves unsaved input', async ({ page }) => {
  const requests = await setup(page, [
    'price.finished.view',
    'price.finished.batch-set',
    'price.accessory.view',
    'price.accessory.batch-set',
  ]);
  let rejected = false;
  await page.route('**/api/admin/store-price-rules/price/save?scope=accessory', async (route) => {
    if (rejected) return route.fallback();
    rejected = true;
    await route.fulfill({ json: { code: 400, message: '保存失败，请重试', data: null } });
  });
  await page.goto('/store/price-configuration');
  const parentInput = page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('input:not([type=checkbox])');
  await parentInput.fill('2.5');
  await menu(page).getByText('配件', { exact: true }).click();
  const input = page.getByRole('row').filter({ hasText: '未配置配件' }).locator('input:not([type=checkbox])');
  await input.fill('1.5');
  const checkbox = page.getByRole('row').filter({ hasText: '未配置配件' }).locator('.t-checkbox');
  await checkbox.click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存失败，请重试', { exact: true })).toBeVisible();
  await expect(checkbox).toHaveClass(/t-is-checked/);
  await expect(input).toHaveValue('1.50');
  await expect(input).toBeEnabled();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  await expect(checkbox).not.toHaveClass(/t-is-checked/);
  await expect(page.locator('thead .t-checkbox')).not.toHaveClass(/t-is-checked|t-is-indeterminate/);
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    scope: 'accessory',
    body: { changes: [{ categoryId: 13, coefficient: 1.5 }] },
  });
  await menu(page).getByText('成品现货', { exact: true }).click();
  await expect(parentInput).toHaveValue('2.50');
});

test('price navigation uses fixed groups and remains visible when group titles are clicked', async ({ page }) => {
  await setup(page, [
    'price.finished.view',
    'price.accessory.view',
    'discount.finished.view',
    'discount.accessory.view',
  ]);
  await page.goto('/store/price-configuration');
  await expect(menu(page).locator('.t-menu-group__title')).toHaveText(['价格系数', '折扣系数']);
  await expect(menu(page).locator('.t-submenu')).toHaveCount(0);
  await expect(menu(page).locator('.t-menu-group .t-menu__item')).toHaveText(['成品现货', '配件', '成品现货', '配件']);
  await menu(page).getByText('价格系数', { exact: true }).click();
  await menu(page).getByText('折扣系数', { exact: true }).click();
  for (const item of await menu(page).locator('.t-menu-group .t-menu__item').all()) await expect(item).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '本店餐桌' })).toBeVisible();
  await expect(page.locator('.price-navigation.t-card--bordered')).toBeVisible();
});

test('blank batch is required and leaves category inputs unchanged; inline clearing remains available', async ({
  page,
}) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set']);
  await page.goto('/store/price-configuration');
  await page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量设置' }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('留空将清除所选分类的价格系数')).toHaveCount(0);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.t-input__tips')).toHaveText('请输入价格系数');
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: '请输入价格系数' })).toBeVisible();
  const categoryInput = page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('input:not([type=checkbox])');
  await expect(categoryInput).toHaveValue('2.00');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '批量设置', exact: true }).click();
  await expect(dialog.locator('.t-input__tips')).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await categoryInput.fill('');
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    path: '/api/admin/store-price-rules/price/save',
    scope: 'finished',
    body: { changes: [{ categoryId: 12, coefficient: null }] },
  });
  await page.reload();
  const input = page.getByRole('row').filter({ hasText: '石材餐桌' }).locator('input:not([type=checkbox])');
  await expect(input).toHaveValue('');
  await input.focus();
  await page.getByPlaceholder('请输入分类名称').click();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});

test('price table columns stay stable after loading and reloading with coefficient inputs', async ({ page }) => {
  await setup(page, ['price.finished.view', 'price.finished.batch-set']);
  await page.setViewportSize({ width: 1368, height: 858 });
  await page.goto('/store/price-configuration');
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.getByRole('row').filter({ hasText: '石材餐桌' })).toBeVisible();
    const positions = await page.locator('.t-table__th-coefficient').evaluate(async (cell) => {
      const samples: number[] = [];
      const end = performance.now() + 1500;
      while (performance.now() < end) {
        samples.push(cell.getBoundingClientRect().left);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return samples;
    });
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
    const fits = await page
      .getByRole('row')
      .filter({ hasText: '石材餐桌' })
      .locator('td')
      .last()
      .evaluate((cell) => {
        const input = cell.querySelector('.t-input-number')!;
        return (
          input.getBoundingClientRect().right <=
          cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight) + 1
        );
      });
    expect(fits).toBe(true);
    await expect(page.locator('tbody .t-input-number').first()).toHaveCSS('width', '72px');
    if (attempt === 0) await page.reload();
  }
});

test('category expansion uses a button without hover underline and supports keyboard toggling', async ({ page }) => {
  await setup(page, ['price.finished.view']);
  await page.goto('/store/price-configuration');
  const parent = page.getByRole('row').filter({ hasText: '本店餐桌' });
  const toggle = parent.getByRole('button', { name: '收起下级分类' });
  await toggle.hover();
  await expect(toggle).toHaveCSS('text-decoration-line', 'none');
  await toggle.focus();
  await toggle.press('Enter');
  await expect(page.getByText('石材餐桌', { exact: true })).toHaveCount(0);
  await expect(parent.getByRole('button', { name: '展开下级分类' })).toBeFocused();
  await parent.getByRole('button', { name: '展开下级分类' }).press('Space');
  await expect(page.getByText('石材餐桌', { exact: true })).toBeVisible();
});

test('first root expands fully; cascade selection includes collapsed descendants and batch writes only leaves', async ({
  page,
}) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set'], true);
  await page.goto('/store/price-configuration');
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(page.getByText('深层末级分类', { exact: true })).toBeVisible();
  await expect(page.getByText('另一二级分类', { exact: true })).toHaveCount(0);
  await row('另一一级分类').locator('.t-checkbox').click();
  await expect(row('另一一级分类').getByRole('checkbox')).toBeChecked();
  await row('另一一级分类').getByRole('button', { name: '展开下级分类' }).click();
  await row('另一二级分类').getByRole('button', { name: '展开下级分类' }).click();
  await expect(row('另一末级甲').getByRole('checkbox')).toBeChecked();
  await expect(row('另一末级乙').getByRole('checkbox')).toBeChecked();
  await row('另一二级分类').locator('.t-checkbox').click();
  await expect(row('另一末级甲').getByRole('checkbox')).not.toBeChecked();
  await row('另一二级分类').locator('.t-checkbox').click();
  await row('另一末级甲').locator('.t-checkbox').click();
  await expect(row('另一末级乙').getByRole('checkbox')).toBeChecked();
  await expect(row('另一末级甲').getByRole('checkbox')).not.toBeChecked();
  await expect(row('另一二级分类').locator('.t-checkbox')).toHaveClass(/t-is-indeterminate/);
  await row('另一一级分类').getByRole('button', { name: '收起下级分类' }).click();
  await row('本店餐桌').getByRole('button', { name: '收起下级分类' }).click();
  await page.locator('thead .t-checkbox').click();
  await expect(row('本店餐桌').getByRole('checkbox')).toBeChecked();
  await expect(row('另一一级分类').getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '批量设置', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.locator('.t-input-number input').fill('2.4');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await row('本店餐桌').getByRole('button', { name: '展开下级分类' }).click();
  await expect(row('深层末级分类').locator('input:not([type=checkbox])')).toHaveValue('2.40');
  await expect(row('本店餐桌').locator('.t-input-number')).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    body: { changes: [12, 14, 16, 23, 24].map((categoryId) => ({ categoryId, coefficient: 2.4 })) },
  });
});

test('unconfigured filter uses saved leaf coefficients, preserves paths and drafts, and resets on type switching', async ({
  page,
}) => {
  const requests = await setup(page, ['price.finished.view', 'price.finished.batch-set', 'price.accessory.view'], true);
  await page.goto('/store/price-configuration');
  const filter = page.getByRole('checkbox', { name: '仅看未配置分类', exact: true });
  await expect(filter).not.toBeChecked();
  await page.locator('.t-checkbox').filter({ hasText: '仅看未配置分类' }).click();
  await expect(page.getByText('石材餐桌', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('石材餐桌', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本店餐桌', { exact: true })).toBeVisible();
  await expect(page.getByText('深层分类', { exact: true })).toBeVisible();
  await expect(page.getByText('另一末级甲', { exact: true })).toBeVisible();
  const otherRoot = page.getByRole('row').filter({ hasText: '另一一级分类' });
  await otherRoot.getByRole('button', { name: '收起下级分类' }).click();
  await expect(page.getByText('另一末级甲', { exact: true })).toHaveCount(0);
  await otherRoot.getByRole('button', { name: '展开下级分类' }).click();
  await expect(page.getByText('另一末级甲', { exact: true })).toBeVisible();
  const input = page.getByRole('row').filter({ hasText: '木质餐桌' }).locator('input:not([type=checkbox])');
  await input.fill('3.25');
  await page.getByPlaceholder('请输入分类名称').fill('木质');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(input).toHaveValue('3.25');
  await expect(page.getByText('另一一级分类', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('价格配置已保存', { exact: true })).toBeVisible();
  await expect(page.getByText('木质餐桌', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(filter).not.toBeChecked();
  await expect(page.getByPlaceholder('请输入分类名称')).toHaveValue('');
  await expect(input).toHaveValue('3.25');
  await page.locator('.t-checkbox').filter({ hasText: '仅看未配置分类' }).click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await menu(page).getByText('配件', { exact: true }).click();
  await expect(filter).not.toBeChecked();
  await expect(page.getByText('未配置配件', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
});

test('discounts list configured records only; query is explicit and create validates required fields and role choices', async ({
  page,
}) => {
  const requests = await setup(page, ['discount.finished.view', 'discount.finished.create']);
  await page.goto('/store/price-configuration');
  await expect(page.locator('thead th')).toHaveText(['角色', '折扣系数', '创建人', '创建时间']);
  await expect(page.getByText('导购', { exact: true })).toHaveCount(0);
  await expect(page.getByText('折扣说明', { exact: true })).toHaveCount(0);
  await page.getByPlaceholder('请输入角色').fill('导购');
  await expect(page.getByText('店长', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('店长', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.getByPlaceholder('请输入角色')).toHaveValue('');
  await expect(page.getByText('店长', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  const initialDialogHeight = await dialog.evaluate((element) => element.clientHeight);
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const input = element.querySelector('.t-input-number') as HTMLElement;
        const button = element.querySelector('.t-dialog__footer .t-button') as HTMLElement;
        return Math.round(button.getBoundingClientRect().top - input.getBoundingClientRect().bottom);
      }),
    )
    .toBe(32);
  const fieldTopDistance = () =>
    dialog
      .locator('.t-form__item')
      .evaluateAll((items) => (items[1] as HTMLElement).offsetTop - (items[0] as HTMLElement).offsetTop);
  const initialFieldDistance = await fieldTopDistance();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText('请选择角色', { exact: true })).toBeVisible();
  await expect(dialog.getByText('请输入折扣系数', { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      dialog.getByText('请输入折扣系数', { exact: true }).evaluate((element) => {
        const input = element.parentElement!.querySelector('.t-input-number')!;
        return Math.round(element.getBoundingClientRect().left - input.getBoundingClientRect().left);
      }),
    )
    .toBe(0);
  await expect(page.locator('.t-message')).toHaveCount(0);
  await expect.poll(() => dialog.evaluate((element) => element.clientHeight)).toBe(initialDialogHeight);
  await expect.poll(fieldTopDistance).toBe(initialFieldDistance);
  await expect
    .poll(() =>
      dialog
        .locator('.t-dialog__body')
        .evaluate((body) => body.scrollHeight <= body.clientHeight || getComputedStyle(body).overflowY === 'visible'),
    )
    .toBe(true);
  await dialog.locator('.t-select').click();
  await expect(page.locator('.t-select-option').filter({ hasText: '店长' })).toHaveCount(0);
  await page.locator('.t-select-option').filter({ hasText: '导购' }).click();
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByText('请输入折扣系数', { exact: true })).toBeVisible();
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await dialog.locator('.t-input-number input').click();
  await dialog.locator('.t-input-number input').fill('1.01');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const coefficientError = dialog.getByText('请输入0.01至1.00之间的折扣系数，最多两位小数', { exact: true });
  await expect(coefficientError).toBeVisible();
  await expect
    .poll(() =>
      coefficientError.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.scrollWidth <= element.clientWidth &&
          style.whiteSpace === 'normal' &&
          element.clientHeight > parseFloat(style.lineHeight)
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      dialog
        .locator('.t-dialog__body')
        .evaluate((body) => body.scrollHeight <= body.clientHeight || getComputedStyle(body).overflowY === 'visible'),
    )
    .toBe(true);
  await expect.poll(() => dialog.evaluate((element) => element.clientHeight)).toBeGreaterThan(initialDialogHeight);
  await expect
    .poll(() =>
      coefficientError.evaluate((element) => {
        const footer = element.closest('.t-dialog')!.querySelector('.t-dialog__footer .t-button')!;
        return element.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top;
      }),
    )
    .toBe(true);
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await expect
    .poll(() =>
      coefficientError.evaluate((element) => {
        const input = element.parentElement!.querySelector('.t-input-number')!;
        return Math.round(element.getBoundingClientRect().left - input.getBoundingClientRect().left);
      }),
    )
    .toBe(0);
  await dialog.locator('.t-input-number input').fill('0.75');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: '导购' }).getByText('0.75', { exact: true })).toBeVisible();
  expect(requests.find((request) => request.method === 'POST')).toMatchObject({
    scope: 'finished',
    path: '/api/admin/store-price-rules/discount',
    body: { roleId: 8, coefficient: 0.75 },
  });
});

test('discount audit fields and permission-controlled edit, disable, enable and delete use existing records', async ({
  page,
}) => {
  const requests = await setup(
    page,
    ['view', 'edit', 'toggle-status', 'delete'].map((action) => `discount.finished.${action}`),
  );
  await page.goto('/store/price-configuration');
  await expect(page.locator('thead th')).toHaveText(['角色', '折扣系数', '创建人', '创建时间', '操作']);
  await expect(page.getByText('测试员工', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('2026/10/10 10:05', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: '店长' });
  await row.getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.t-input-number input')).toHaveValue('0.80');
  await dialog.locator('.t-input-number input').click();
  await dialog.locator('.t-input-number input').fill('0.7');
  await dialog.locator('.t-input-number input').press('Tab');
  await expect(dialog.locator('.t-input-number input')).toHaveValue('0.70');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.find((request) => request.method === 'PUT')).toMatchObject({ body: { coefficient: 0.7, roleId: 7 } });
  await expect(row.getByText('0.70', { exact: true })).toBeVisible();
  await row.getByText('停用', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(row.getByText('启用', { exact: true })).toBeVisible();
  await row.getByText('启用', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认启用', exact: true }).click();
  await expect(row.getByText('停用', { exact: true })).toBeVisible();
  await row.getByText('删除', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
  expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(3);
});
