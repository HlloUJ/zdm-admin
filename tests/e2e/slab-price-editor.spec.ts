import { checkDecimalEditing } from './decimal-editing';
import { expect, test, type Page } from '@playwright/test';
import type { SlabPayload, SlabPrice, SlabRecord } from '../../src/services/slabs';
import type { SlabMarkupConfigurationRecord } from '../../src/services/slabMarkupConfigurations';
import { installAdminApiMocks } from './admin-api-mocks';

async function setup(
  page: Page,
  configurationStatus?: 'enabled' | 'disabled',
  savedPrices: SlabPrice[] = [],
  levelEnabled = true,
) {
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'admin',
        name: '大板价格测试',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  const state = {
    product: {
      id: 99601,
      name: '四级价格大板',
      serialNo: 'SLAB-PRICE',
      status: 'warehouse',
      sourceStatus: 'selling',
      stock: 1,
      costPrice: 1000,
      guidePrice: 2000,
      guidePriceCoefficient: 2,
      markupPrices: savedPrices,
    } as SlabRecord,
    configurations: configurationStatus
      ? ([
          {
            id: 84,
            storeLevelId: 4,
            name: '4级合伙人',
            priceCoefficient: 1.4,
            status: configurationStatus,
            sortOrder: 1,
          },
        ] as SlabMarkupConfigurationRecord[])
      : [],
    saves: [] as SlabPayload[],
  };
  await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: [state.product] } }));
  await page.route('**/api/admin/slabs/form-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          textures: [],
          colorCategories: [],
          grades: [],
          suppliers: [],
          varieties: [],
          origins: [],
          storeLevels: levelEnabled ? [{ id: 4, label: '4级合伙人', status: 'enabled' }] : [],
        },
      },
    }),
  );
  await page.route('**/api/admin/slab-markup-configurations/options', (route) =>
    route.fulfill({ json: { code: 0, data: state.configurations } }),
  );
  await page.route('**/api/admin/slabs/99601', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { code: 0, data: state.product } });
    const payload = route.request().postDataJSON() as SlabPayload;
    state.saves.push(payload);
    return route.fulfill({ json: { code: 0, data: { ...state.product, ...payload } } });
  });
  await page.goto('/slab-management');
  await expect(page.getByRole('main').getByText('四级价格大板', { exact: true })).toBeVisible();
  return state;
}

async function openEditor(page: Page) {
  await page.getByRole('main').locator('.table-actions').getByText('编辑', { exact: true }).click();
  const editor = page.locator('.slab-publish-page');
  await expect(editor).toBeVisible();
  return { editor, level: editor.locator('.price-editor__row').filter({ hasText: '4级合伙人' }) };
}

for (const canViewPrice of [true, false]) {
  test(`supply-chain off-shelf slab price is ${canViewPrice ? 'read-only when granted' : 'hidden without permission'}`, async ({
    page,
  }) => {
    await installAdminApiMocks(page);
    await page.addInitScript(
      ({ canViewPrice }) => {
        localStorage.setItem('zdm-admin-token', 'dev-token');
        localStorage.setItem(
          'zdm-admin-user',
          JSON.stringify({
            id: 2,
            clientCode: 'supply-chain',
            name: '大板价格权限测试',
            roles: ['OPERATOR'],
            permissions: [
              'supply-chain.slab-management.off-shelf.view',
              'supply-chain.slab-management.off-shelf.detail',
              'supply-chain.slab-management.off-shelf.restore',
              'supply-chain.slab-management.off-shelf.delete',
              ...(canViewPrice ? ['supply-chain.slab-management.off-shelf.price'] : []),
            ],
            dataPermission: 'all',
          }),
        );
      },
      { canViewPrice },
    );
    const product = {
      id: 99601,
      name: '供应链已下架大板',
      serialNo: 'SLAB-COST',
      status: 'offShelf',
      sourceStatus: 'offShelf',
      stock: 1,
      costPrice: 100,
      guidePrice: 200,
      markupPrices: [],
    };
    await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: [product] } }));
    await page.route('**/api/admin/slabs/form-options', (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: {
            textures: [],
            colorCategories: [],
            grades: [],
            suppliers: [],
            varieties: [],
            origins: [],
            storeLevels: [],
          },
        },
      }),
    );
    await page.goto('/supply-chain/slab-management');
    const main = page.getByRole('main');
    await expect(main.locator('.table-actions .t-link')).toHaveText(['详情', '放回仓库', '删除']);
    await expect(main.locator('.table-actions').getByText('价格', { exact: true })).toHaveCount(0);
  });
}

for (const status of ['enabled', 'disabled', undefined] as const) {
  test(`缺失四级价格与成品现货一致：${status ?? 'unconfigured'} 不在编辑器中预计算`, async ({ page }) => {
    const state = await setup(page, status);
    const { editor, level } = await openEditor(page);
    await expect(level.getByPlaceholder('请输入系数', { exact: true })).toHaveValue(status === 'enabled' ? '1.40' : '');
    await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('');
    await expect(
      level.getByRole('button', {
        name: status === 'enabled' ? '跟随配置，点击切换手工价格' : '手工价格，点击切换跟随配置',
        exact: true,
      }),
    ).toBeVisible();
    const rowHeight = await level.evaluate((element) => element.getBoundingClientRect().height);
    const assertCentered = async () => {
      const offsets = await level.evaluate((element) => {
        const row = element.getBoundingClientRect();
        return [...element.querySelectorAll('.t-input, button')].map((control) => {
          const box = control.getBoundingClientRect();
          return Math.abs(box.y + box.height / 2 - (row.y + row.height / 2));
        });
      });
      offsets.forEach((offset) => expect(offset).toBeLessThan(1));
    };
    await assertCentered();
    const costRow = editor.locator('.price-editor__row').filter({ hasText: '成本价' });
    await expect(costRow.locator('input')).toHaveCount(0);
    await expect(costRow).toContainText('1000.00');
    await editor.getByRole('button', { name: '提交商品信息', exact: true }).click();
    await expect(page.locator('.zdm-admin-feedback')).toHaveText('表单校验未通过，请检查标红字段');
    expect(await level.evaluate((element) => element.getBoundingClientRect().height)).toBe(rowHeight);
    await assertCentered();
    await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
    expect(state.saves).toHaveLength(0);
    if (status !== 'enabled') {
      await level.getByRole('button').click();
      await expect(page.getByText('暂无有效价格配置，无法切换为跟随配置', { exact: true })).toBeVisible();
      await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
    }
    await level.getByPlaceholder('请输入系数', { exact: true }).fill('1.60');
    await level.getByPlaceholder('请输入系数', { exact: true }).blur();
    await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1600.00');
    await expect(level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '提交商品信息', exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(state.saves).toHaveLength(1);
    expect(state.saves[0].markupPrices).toEqual([
      expect.objectContaining({
        storeLevelId: 4,
        priceCoefficient: 1.6,
        costPrice: 1000,
        price: 1600,
        priceSource: 'manual',
      }),
    ]);
    expect(state.saves[0].markupPrices![0].sourceConfigurationId).toBeUndefined();
  });
}

for (const source of ['auto', 'manual'] as const) {
  test(`已有四级 ${source} 价格在配置停用后仍按保存值回显`, async ({ page }) => {
    const state = await setup(page, 'disabled', [
      {
        storeLevelId: 4,
        storeLevelName: '4级合伙人',
        priceCoefficient: 1.6,
        costPrice: 1000,
        price: 1600,
        priceSource: source,
        sourceConfigurationId: source === 'auto' ? 84 : undefined,
      },
    ]);
    const { level } = await openEditor(page);
    await expect(level.getByPlaceholder('请输入系数', { exact: true })).toHaveValue('1.60');
    await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1600.00');
    await level.getByPlaceholder('请输入价格', { exact: true }).focus();
    await level.getByPlaceholder('请输入价格', { exact: true }).blur();
    await expect(
      level.getByRole('button', {
        name: source === 'auto' ? '跟随配置，点击切换手工价格' : '手工价格，点击切换跟随配置',
        exact: true,
      }),
    ).toBeVisible();
    expect(state.saves).toHaveLength(0);
  });
}

test('打开商品编辑页刷新配置和价格，已保存的零成本零售价正常回显', async ({ page }) => {
  const state = await setup(page, 'enabled');
  state.configurations = [];
  state.product.costPrice = 0;
  state.product.guidePrice = 0;
  state.product.markupPrices = [
    {
      storeLevelId: 4,
      storeLevelName: '4级合伙人',
      priceCoefficient: 1.4,
      costPrice: 0,
      price: 0,
      priceSource: 'manual',
    },
  ];
  const { editor, level } = await openEditor(page);
  const costRow = editor.locator('.price-editor__row').filter({ hasText: '成本价' });
  await expect(costRow.locator('input')).toHaveCount(0);
  await expect(costRow).toContainText('0.00');
  await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('0.00');
  await level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
  await expect(page.getByText('暂无有效价格配置，无法切换为跟随配置', { exact: true })).toBeVisible();
  expect(state.saves).toHaveLength(0);
});

test('恢复跟随需确认，确认后按当前启用系数计算并保存自动来源', async ({ page }) => {
  const state = await setup(page, 'enabled', [
    {
      storeLevelId: 4,
      storeLevelName: '4级合伙人',
      priceCoefficient: 1.6,
      costPrice: 1000,
      price: 1600,
      priceSource: 'manual',
    },
  ]);
  const { editor, level } = await openEditor(page);
  await level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog).toContainText('是否更改价格跟随价格配置浮动？');
  await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1600.00');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1600.00');
  await level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(level.getByPlaceholder('请输入系数', { exact: true })).toHaveValue('1.40');
  await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1400.00');
  await expect(level.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '提交商品信息', exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].markupPrices).toEqual([
    expect.objectContaining({
      storeLevelId: 4,
      priceCoefficient: 1.4,
      price: 1400,
      priceSource: 'auto',
      sourceConfigurationId: 84,
    }),
  ]);
});

test('停用门店级别不展示历史价格且保存不提交停用级别', async ({ page }) => {
  const state = await setup(
    page,
    'enabled',
    [
      {
        storeLevelId: 4,
        priceCoefficient: 1.4,
        costPrice: 1000,
        price: 1400,
        priceSource: 'auto',
        sourceConfigurationId: 84,
      },
    ],
    false,
  );
  const { editor, level } = await openEditor(page);
  await expect(level).toHaveCount(0);
  await editor.getByRole('button', { name: '提交商品信息', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].markupPrices).toEqual([]);
});

test('大板价格与系数删除末位后可继续输入小数', async ({ page }) => {
  await setup(page, 'enabled');
  const { editor, level } = await openEditor(page);
  const guide = editor.locator('.price-editor__row').filter({ hasText: '指导价' });
  for (const row of [guide, level]) {
    await checkDecimalEditing(row.getByPlaceholder('请输入系数', { exact: true }));
    await checkDecimalEditing(row.getByPlaceholder('请输入价格', { exact: true }));
  }
});

test('运营编辑大板的只读信息使用无必填星号表格，保留价格编辑和原数据提交', async ({ page }) => {
  const state = await setup(page, 'enabled');
  Object.assign(state.product, {
    varietyId: 11,
    varietyName: '只读品种',
    originId: 21,
    originName: '只读产地',
    textureId: 31,
    colorId: 41,
    gradeId: 51,
    supplierId: 61,
    supplierName: '只读供应商',
    serialNo: 'READONLY-SLAB',
    lengthMm: 2000,
    widthMm: 1800,
    thicknessMm: 10,
    toleranceMm: 0,
    corner1LengthMm: 0,
    corner1WidthMm: 10,
  });
  await page.route('**/api/admin/slabs/form-options', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          textures: [{ id: 31, label: '只读纹理', status: 'enabled' }],
          colorCategories: [
            {
              id: 40,
              label: '只读色系分组',
              status: 'enabled',
              children: [{ id: 41, label: '只读色系', status: 'enabled' }],
            },
          ],
          grades: [{ id: 51, label: 'A', description: '只读等级', status: 'enabled' }],
          suppliers: [{ id: 61, label: '只读供应商', status: 'enabled' }],
          varieties: [{ id: 11, label: '只读品种', status: 'enabled' }],
          origins: [{ id: 21, label: '只读产地', status: 'enabled' }],
          storeLevels: [{ id: 4, label: '4级合伙人', status: 'enabled' }],
        },
      },
    }),
  );
  await page.reload();
  const { editor, level } = await openEditor(page);
  const base = editor.locator('#slab-product-base');
  await expect(base.locator('input, select, textarea')).toHaveCount(0);
  for (const text of ['只读品种', '只读产地', '只读纹理', '只读色系', 'A（只读等级）', '3.60 ㎡']) {
    await expect(base.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(base.locator('table')).toHaveCount(3);
  await expect(base.getByText('0', { exact: true })).toHaveCount(2);
  await expect(base.getByText('*', { exact: true })).toHaveCount(0);
  await expect(editor.locator('#slab-product-images .admin-media-upload__required')).toHaveCount(0);
  const sales = editor.locator('#slab-product-sales');
  await expect(sales.locator('.t-descriptions')).toHaveCount(1);
  await expect(sales.locator('.t-descriptions input')).toHaveCount(0);
  await expect(sales.locator('.t-descriptions').getByText('*', { exact: true })).toHaveCount(0);
  await expect(sales.locator('.price-required-star')).toHaveCount(2);
  for (const field of ['supplier', 'stock', 'sku']) {
    await expect(sales.locator(`.t-form-item__${field} input`)).toHaveCount(0);
  }
  await expect(sales.getByText('只读供应商', { exact: true })).toBeVisible();
  await expect(sales.getByText('READONLY-SLAB', { exact: true })).toBeVisible();
  await expect(level.getByPlaceholder('请输入系数', { exact: true })).toBeEditable();
  await level.getByPlaceholder('请输入系数', { exact: true }).fill('1.60');
  await level.getByPlaceholder('请输入系数', { exact: true }).blur();
  await expect(level.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('1600.00');
  await editor.getByRole('button', { name: '提交商品信息', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(Object.keys(state.saves[0]).sort()).toEqual(
    ['name', 'serialNo', 'status', 'costPrice', 'guidePrice', 'guidePriceCoefficient', 'markupPrices'].sort(),
  );
  expect(state.saves[0]).toMatchObject({
    serialNo: 'READONLY-SLAB',
    costPrice: 1000,
    markupPrices: [{ storeLevelId: 4, priceCoefficient: 1.6, costPrice: 1000, price: 1600 }],
  });
});
