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
    const payload = route.request().postDataJSON() as SlabPayload;
    state.saves.push(payload);
    return route.fulfill({ json: { code: 0, data: { ...state.product, ...payload } } });
  });
  await page.goto('/slab-management');
  await expect(page.getByRole('main').getByText('四级价格大板', { exact: true })).toBeVisible();
  return state;
}

async function openEditor(page: Page) {
  await page.getByRole('main').locator('.table-actions').getByText('价格', { exact: true }).click();
  const editor = page.locator('.t-drawer--open').filter({ has: page.getByText('价格编辑器', { exact: true }) });
  await expect(editor.getByText('价格编辑器', { exact: true })).toBeVisible();
  return { editor, level: editor.locator('.price-table__row').filter({ hasText: '4级合伙人' }) };
}

for (const status of ['enabled', 'disabled', undefined] as const) {
  test(`缺失四级价格与成品现货一致：${status ?? 'unconfigured'} 不在编辑器中预计算`, async ({ page }) => {
    const state = await setup(page, status);
    const { editor, level } = await openEditor(page);
    await expect(level.getByPlaceholder('系数', { exact: true })).toHaveValue(status === 'enabled' ? '1.40' : '');
    await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('');
    await expect(
      level.getByRole('button', {
        name: status === 'enabled' ? '跟随配置，点击切换手工价格' : '手工价格，点击切换跟随配置',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      editor.locator('.price-table__row').filter({ hasText: '成本价' }).getByPlaceholder('价格', { exact: true }),
    ).toBeDisabled();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText('请完善价格信息', { exact: true })).toBeVisible();
    await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
    expect(state.saves).toHaveLength(0);
    if (status !== 'enabled') {
      await level.getByRole('button').click();
      await expect(page.getByText('暂无有效价格配置，无法切换为跟随配置', { exact: true })).toBeVisible();
      await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
    }
    await level.getByPlaceholder('系数', { exact: true }).fill('1.60');
    await level.getByPlaceholder('系数', { exact: true }).blur();
    await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
    await expect(level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.t-dialog:visible').getByRole('button', { name: '确认保存价格', exact: true }).click();
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
    await expect(level.getByPlaceholder('系数', { exact: true })).toHaveValue('1.60');
    await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
    await level.getByPlaceholder('价格', { exact: true }).focus();
    await level.getByPlaceholder('价格', { exact: true }).blur();
    await expect(
      level.getByRole('button', {
        name: source === 'auto' ? '跟随配置，点击切换手工价格' : '手工价格，点击切换跟随配置',
        exact: true,
      }),
    ).toBeVisible();
    expect(state.saves).toHaveLength(0);
  });
}

test('打开价格编辑器刷新配置和价格，已保存的零成本零售价正常回显', async ({ page }) => {
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
  await expect(
    editor.locator('.price-table__row').filter({ hasText: '成本价' }).getByPlaceholder('价格', { exact: true }),
  ).toHaveValue('0.00');
  await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('0.00');
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
  await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('1600.00');
  await level.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(level.getByPlaceholder('系数', { exact: true })).toHaveValue('1.40');
  await expect(level.getByPlaceholder('价格', { exact: true })).toHaveValue('1400.00');
  await expect(level.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await dialog.getByRole('button', { name: '确认保存价格', exact: true }).click();
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
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '确认保存价格', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].markupPrices).toEqual([]);
});
