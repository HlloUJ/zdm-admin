import { expectSpecTableFillsContainer, priceTableGeometry, expectPriceTableStable } from './price-table-feedback';
import { checkNumericEditingRecovery } from './decimal-editing';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { productWarehouseUrl } from './product-test-navigation';

type Resource = 'finished-products' | 'accessory-products';
async function openEditor(
  page: Page,
  resource: Resource,
  install: (page: Page) => Promise<void>,
  layered = false,
  numberLabel = '销售数字属性',
  variantCount = 2,
  client = 'supply-chain',
  guideFixture?: { coefficient: number | null },
  historicalFixture?: 'bound' | 'unknown' | 'saved',
) {
  await page.addInitScript(() => localStorage.setItem('zdm-admin-token', 'dev-token'));
  await install(page);
  if (client === 'admin')
    await page.addInitScript(() => {
      const user = JSON.parse(localStorage.getItem('zdm-admin-user') || '{}');
      localStorage.setItem('zdm-admin-user', JSON.stringify({ ...user, clientCode: 'admin' }));
    });
  const snapshot = [
    {
      attributeId: 1,
      name: '商品数字属性',
      attributeRole: 'product',
      valueType: 'number',
      requiredFlag: true,
      skuFlag: false,
      sortOrder: 1,
      options: [],
    },
    {
      attributeId: 2,
      name: numberLabel,
      attributeRole: 'sales',
      valueType: 'number',
      requiredFlag: true,
      skuFlag: true,
      sortOrder: 2,
      options: [],
    },
    {
      attributeId: 3,
      name: '销售选项属性',
      attributeRole: 'sales',
      valueType: 'select',
      requiredFlag: true,
      skuFlag: true,
      sortOrder: 3,
      options: ['选项1', '选项2', '选项3'].map((value) => ({ value })),
    },
  ];
  const product = {
    id: 95,
    name: '动态属性反馈商品',
    categoryId: 5,
    supplierId: 2,
    status: 'warehouse',
    sourceStatus: client === 'admin' ? 'selling' : 'warehouse',
    templateVersionId: 1,
    templateRevision: 0,
    attributeTemplateSnapshot: snapshot,
    mainImageMediaId: 1,
    mainImageMediaIds: [1],
    videoMediaId: 2,
    detail: '<p>保留详情</p>',
    totalStock: 5,
    ...(guideFixture
      ? {
          guidePrices: Array.from({ length: variantCount }, (_, index) => ({
            skuId: 951 + index,
            variantLabel: `规格${index + 1}`,
            costPrice: (index + 1) * 10,
            priceCoefficient: index === 0 ? 2 : 3,
            price: (index + 1) * 10 * (index === 0 ? 2 : 3),
            priceSource: index === 0 && guideFixture.coefficient != null ? 'auto' : 'manual',
          })),
        }
      : {}),
    attributes: [{ attributeId: 1, attributeName: '商品数字属性', value: '12.00' }],
    specDimensions: layered
      ? [
          { key: 'attribute_2', name: numberLabel, values: ['1.2345', '2.00'] },
          { key: 'attribute_3', name: '销售选项属性', values: ['选项1', '选项2'] },
        ]
      : [],
    variants: Array.from({ length: variantCount }, (_, index) => ({
      id: 951 + index,
      variantLabel: `规格${index + 1}`,
      displayMode: layered ? 'layered' : 'single',
      costPrice: (index + 1) * 10,
      stock: index + 2,
      salesAttributes: {
        attribute_2: index === 0 ? (layered ? '1.2345' : '1.00') : '2.00',
        attribute_3: `选项${index + 1}`,
      },
    })),
  };
  if (historicalFixture) {
    if (historicalFixture !== 'saved') product.specDimensions = [];
    if (historicalFixture === 'unknown') product.attributeTemplateSnapshot = [];
    product.variants[0]!.salesAttributes.attribute_2 = '0';
    Object.assign(product, { attributeDisplayOrder: { product: ['1'], sales: ['attribute_3', 'attribute_2'] } });
  }
  const writes: Record<string, unknown>[] = [];
  await page.route(`**/api/admin/${resource}`, (route) => route.fulfill({ json: { code: 0, data: [product] } }));
  await page.route(new RegExp(`/api/admin/${resource}/95(?:/edit)?$`), (route) => {
    const body = route.request().method() === 'GET' ? {} : route.request().postDataJSON();
    if (route.request().method() !== 'GET') writes.push(body);
    return route.fulfill({ json: { code: 0, data: { ...product, ...body } } });
  });
  await page.route(`**/api/admin/${resource}/price-level-options`, (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.route(`**/api/admin/${resource}/attribute-template-options`, (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            versionId: 2,
            revision: 0,
            categoryId: 5,
            content: historicalFixture
              ? [
                  ...snapshot.map((field) => ({ ...field, skuFlag: false })),
                  { ...snapshot[1]!, attributeId: 4, name: '当前新增维度', skuFlag: true },
                ]
              : [],
          },
        ],
      },
    }),
  );
  if (guideFixture) {
    const setting = resource === 'finished-products' ? 'finished-guide-price-setting' : 'accessory-guide-price-setting';
    await page.route(`**/api/admin/${setting}`, (route) =>
      route.fulfill({
        json: {
          code: 0,
          data: guideFixture.coefficient == null ? null : { priceCoefficient: guideFixture.coefficient },
        },
      }),
    );
  }
  const module = resource === 'finished-products' ? 'finished-stock-management' : 'accessory-management';
  await page.goto(productWarehouseUrl(client === 'admin' ? `/${module}` : `/supply-chain/${module}`));
  await page.getByText('编辑', { exact: true }).first().click();
  await expect(page.locator('.form-shell')).toBeVisible();
  return { table: page.locator('.spec-table-block'), writes, product };
}

async function expectNativeError(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((node) => {
        const control = node.closest('.t-input')!;
        const probe = document.createElement('span');
        probe.style.color = 'var(--td-error-color)';
        control.appendChild(probe);
        const nativeError = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(control).borderColor === nativeError;
      }),
    )
    .toBe(true);
}

async function switchToLayered(page: Page) {
  const dialog = page.locator('.spec-dialog');
  await dialog.getByText('分层展示：选择标准属性构建规格', { exact: true }).click();
  await page.getByRole('button', { name: '确认切换展示模式', exact: true }).click();
  return dialog;
}

export function registerAttributeFeedbackTests(resource: Resource, install: (page: Page) => Promise<void>) {
  for (const historical of ['bound', 'unknown', 'saved'] as const) {
    test(`operations historical specifications preserve version fields and SKU labels, ${historical}`, async ({
      page,
    }) => {
      const { table, writes, product } = await openEditor(
        page,
        resource,
        install,
        true,
        '销售数字属性',
        2,
        'admin',
        { coefficient: 2 },
        historical,
      );
      const originals = structuredClone(product.variants);
      const headers = table.locator('thead th');
      if (historical === 'unknown') {
        await expect(headers.first()).toHaveText('商品规格');
        await expect(table.locator('tbody tr').first()).toContainText('规格1');
      } else {
        await expect(headers.first()).toHaveText(historical === 'saved' ? '销售数字属性' : '销售选项属性');
        await expect(headers.nth(1)).toHaveText(historical === 'saved' ? '销售选项属性' : '销售数字属性');
      }
      await expect(table.getByRole('columnheader', { name: '当前新增维度', exact: true })).toHaveCount(0);
      if (historical !== 'saved') {
        await expect(
          page.getByText('此商品缺少历史规格顺序，已保留原规格；如需调整规格，请在供应链端核对。', { exact: true }),
        ).toBeVisible();
      }
      await page.getByRole('button', { name: '批量填写', exact: true }).click();
      const drawer = page.locator('.t-drawer:visible');
      if (historical !== 'unknown') {
        await expect(drawer.getByText('销售数字属性', { exact: true })).toBeVisible();
        await drawer.getByText('0', { exact: true }).click();
        await expect(drawer.getByText('当前将批量填充 1 条规格', { exact: true })).toBeVisible();
      } else {
        await expect(drawer.getByText('当前将批量填充 2 条规格', { exact: true })).toBeVisible();
      }
      await drawer.getByPlaceholder('请输入价格', { exact: true }).first().fill('50');
      await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
      await page.locator('.form-submit-bar').getByRole('button', { name: '确认保存', exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]!.guidePrices).toEqual([
        expect.objectContaining({ skuId: 951, variantLabel: '规格1', price: 50 }),
        expect.objectContaining({ skuId: 952, variantLabel: '规格2', price: historical === 'unknown' ? 50 : 60 }),
      ]);
      for (const field of [
        'variants',
        'attributes',
        'specDimensions',
        'templateVersionId',
        'attributeTemplateSnapshot',
      ])
        expect(writes[0]).not.toHaveProperty(field);
      expect(product.variants).toEqual(originals);
    });
  }

  test('guide source preserves formatting, supports confirmed switching and batch manual prices per SKU', async ({
    page,
  }) => {
    const { table, writes } = await openEditor(page, resource, install, false, '销售数字属性', 2, 'admin', {
      coefficient: 2,
    });
    const guides = table.locator('tbody .price-pair.with-source');
    const followed = guides.nth(0);
    const manual = guides.nth(1);
    const coefficient = followed.getByPlaceholder('请输入系数');
    await expect(followed.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
    await coefficient.fill('2.0');
    await coefficient.blur();
    await expect(followed.getByRole('button', { name: '跟随配置，点击切换手工价格', exact: true })).toBeVisible();
    await coefficient.fill('4');
    await coefficient.blur();
    await expect(followed.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true })).toBeVisible();
    await expect(followed.getByPlaceholder('请输入价格')).toHaveValue('40.00');
    await followed.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
    await page.locator('.t-dialog:visible .t-dialog__cancel').click();
    await expect(coefficient).toHaveValue('4.00');
    await followed.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
    await page.getByRole('button', { name: '确认更改价格浮动方式', exact: true }).click();
    await expect(followed.getByPlaceholder('请输入价格')).toHaveValue('20.00');
    await expect(manual.getByPlaceholder('请输入价格')).toHaveValue('60.00');
    await page.getByRole('button', { name: '批量填写', exact: true }).click();
    const drawer = page.locator('.t-drawer:visible');
    await drawer.getByPlaceholder('请输入价格', { exact: true }).first().fill('50');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(table.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true })).toHaveCount(2);
    await page.locator('.form-submit-bar').getByRole('button', { name: '确认保存', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.guidePrices).toEqual([
      expect.objectContaining({ skuId: 951, priceCoefficient: 5, price: 50, priceSource: 'manual' }),
      expect.objectContaining({ skuId: 952, priceCoefficient: 2.5, price: 50, priceSource: 'manual' }),
    ]);
  });
  test('guide without configuration keeps manual values and blocks following', async ({ page }) => {
    const { table, writes } = await openEditor(page, resource, install, false, '销售数字属性', 2, 'admin', {
      coefficient: null,
    });
    const guide = table.locator('tbody .price-pair.with-source').first();
    await guide.getByRole('button', { name: '手工价格，点击切换跟随配置', exact: true }).click();
    await expect(page.getByText('暂无有效价格配置，无法切换为跟随配置', { exact: true })).toBeVisible();
    await expect(guide.getByPlaceholder('请输入价格')).toHaveValue('20.00');
    expect(writes).toHaveLength(0);
  });

  for (const client of ['supply-chain', 'admin']) {
    for (const layered of [false, true]) {
      test(`${client} specification columns fill the editor and required marks follow editability, layered=${layered}`, async ({
        page,
      }) => {
        const { table, writes } = await openEditor(page, resource, install, layered, '销售数字属性', 2, client);
        const block = page.locator('.spec-table-block');
        for (const width of [1689, 900, 1393]) {
          await page.setViewportSize({ width, height: 1000 });
          await expectSpecTableFillsContainer(block);
        }
        const headers = block.locator('thead th');
        if (client === 'admin') {
          for (const title of ['成本价', '数量', '销售数字属性', '销售选项属性'])
            await expect(headers.filter({ hasText: new RegExp(`^${title}$`) })).toHaveCount(1);
          await expect(headers.filter({ hasText: /^\*指导价$/ })).toHaveCount(1);
        } else {
          await expect(headers.filter({ hasText: /^\*成本价$/ })).toHaveCount(1);
          await expect(headers.filter({ hasText: /^\*数量$/ })).toHaveCount(1);
          for (const title of ['销售数字属性', '销售选项属性'])
            await expect(headers.filter({ hasText: new RegExp(`^${layered ? '' : '\\*'}${title}$`) })).toHaveCount(1);
        }
        const geometry = await priceTableGeometry(table);
        const price = table.getByPlaceholder('请输入价格', { exact: true }).first();
        await price.fill('');
        await price.blur();
        await expectPriceTableStable(table, geometry);
        await price.fill('10');
        await price.blur();
        await expectPriceTableStable(table, geometry);
        expect(writes).toHaveLength(0);
      });
    }
  }

  test('numeric attributes and prices recover after deletion and Chinese composition before typing digits', async ({
    page,
  }) => {
    const { table, writes } = await openEditor(page, resource, install);
    await checkNumericEditingRecovery(page.locator('.product-attributes-panel input').first());
    await checkNumericEditingRecovery(table.getByPlaceholder('请输入价格', { exact: true }).first());
    expect(writes).toHaveLength(0);
  });
  test('dynamic attributes show every type error with one summary and preserve valid numeric precision', async ({
    page,
  }) => {
    const { table, writes } = await openEditor(page, resource, install);
    const productInput = page.locator('.product-attributes-panel input').first();
    const numbers = table.getByPlaceholder('请输入销售数字属性', { exact: true });
    const geometry = await numbers.nth(1).evaluate((input) => {
      const cell = input.closest('tr')!.getBoundingClientRect(),
        box = input.getBoundingClientRect();
      return { rowHeight: cell.height, offset: box.top - cell.top, width: box.width, height: box.height };
    });
    await productInput.fill('文字');
    await expect(productInput).toHaveValue('12.00');
    await productInput.fill('.');
    await productInput.blur();
    await numbers.nth(0).fill('1.234');
    await expect(numbers.nth(0)).toHaveValue('1.00');
    await numbers.nth(0).fill('.');
    await numbers.nth(0).blur();
    await numbers.nth(1).fill('.');
    await numbers.nth(1).blur();
    await expect(table.getByText('最多输入两位小数', { exact: true })).toHaveCount(0);
    await expect(table.getByText('请输入数字', { exact: true })).toHaveCount(2);
    await expectNativeError(numbers.nth(0));
    await expectNativeError(numbers.nth(1));
    await expect(page.locator('.product-attributes-panel').getByText('请输入数字', { exact: true })).toBeVisible();
    await expect(page.getByText('表单校验未通过，请检查标红字段', { exact: true })).toHaveCount(0);
    await numbers.nth(1).fill('4');
    await expect(table.getByText('请输入数字', { exact: true })).toHaveCount(1);
    await numbers.nth(1).fill('');
    await expect(table.getByText('请输入销售数字属性', { exact: true })).toHaveCount(0);
    await numbers.nth(1).fill('.');
    await numbers.nth(1).blur();
    expect(writes).toHaveLength(0);
    await page
      .locator('.form-submit-bar')
      .getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true })
      .click();
    await expect(page.getByText('表单校验未通过，请检查标红字段', { exact: true })).toHaveCount(1);
    await expect(page.locator('.product-attributes-panel').getByText('请输入数字', { exact: true })).toBeVisible();
    await expect(table.getByText('最多输入两位小数', { exact: true })).toHaveCount(0);
    await expect(table.getByText('请输入数字', { exact: true })).toHaveCount(2);
    await expectNativeError(productInput);
    await expectNativeError(numbers.nth(0));
    await expectNativeError(numbers.nth(1));
    expect(
      await numbers.nth(1).evaluate((input) => {
        const cell = input.closest('tr')!.getBoundingClientRect(),
          box = input.getBoundingClientRect();
        return { rowHeight: cell.height, offset: box.top - cell.top, width: box.width, height: box.height };
      }),
    ).toEqual(geometry);
    expect(writes).toHaveLength(0);
    const tips = table.locator('.t-input__tips').filter({ hasText: /^(请输入数字|最多输入两位小数)$/ });
    for (const tip of await tips.all()) {
      expect(
        await tip.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const row = element.closest('tr')!.getBoundingClientRect();
          return (
            element.scrollWidth <= element.clientWidth &&
            box.bottom <= row.bottom &&
            box.top >= element.parentElement!.querySelector('input')!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(true);
    }
    await productInput.fill('12.5');
    await productInput.blur();
    await numbers.nth(0).fill('-3.5');
    await expect(numbers.nth(0)).toHaveValue('.');
    await numbers.nth(0).fill('3.5');
    await numbers.nth(0).blur();
    await numbers.nth(1).fill('4');
    await numbers.nth(1).blur();
    await expect(productInput).toHaveValue('12.50');
    await expect(numbers.nth(0)).toHaveValue('3.50');
    await expect(numbers.nth(1)).toHaveValue('4.00');
    await page
      .locator('.form-submit-bar')
      .getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]!.attributes).toEqual([{ attributeId: 1, attributeName: '商品数字属性', value: '12.50' }]);
    expect(writes[0]!.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 951, stock: 2, salesAttributes: { attribute_2: '3.50', attribute_3: '选项1' } }),
        expect.objectContaining({ id: 952, stock: 3, salesAttributes: { attribute_2: '4.00', attribute_3: '选项2' } }),
      ]),
    );
  });

  test('batch dynamic attribute rejection is atomic and blanks never override required source values', async ({
    page,
  }) => {
    const { table, writes } = await openEditor(page, resource, install);
    const numbers = table.getByPlaceholder('请输入销售数字属性', { exact: true });
    await page.getByRole('button', { name: '批量填写', exact: true }).click();
    const drawer = page.locator('.t-drawer--open').filter({ hasText: '批量填写' });
    const number = drawer.getByPlaceholder('请输入销售数字属性', { exact: true });
    await number.fill('文字');
    await expect(number).toHaveValue('');
    await number.fill('.');
    await number.blur();
    await expect(drawer.getByText('请输入数字', { exact: true })).toBeVisible();
    await expectNativeError(number);
    await expect(page.getByText('表单校验未通过，请检查标红字段', { exact: true })).toHaveCount(0);
    await number.fill('7.5');
    await expect(drawer.getByText('请输入数字', { exact: true })).toHaveCount(0);
    await number.fill('');
    await expect(drawer.locator('.t-input__tips.t-is-error')).toHaveCount(0);
    await number.fill('7.555');
    await expect(number).toHaveValue('');
    await number.fill('.');
    await number.blur();
    await expect(drawer.getByText('请输入数字', { exact: true })).toBeVisible();
    await expectNativeError(number);
    await expect(page.getByText('表单校验未通过，请检查标红字段', { exact: true })).toHaveCount(0);
    await expect(numbers.nth(0)).toHaveValue('1.00');
    await expect(numbers.nth(1)).toHaveValue('2.00');
    expect(writes).toHaveLength(0);
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('请输入数字', { exact: true })).toBeVisible();
    await expectNativeError(number);
    await expect(numbers.nth(0)).toHaveValue('1.00');
    await expect(numbers.nth(1)).toHaveValue('2.00');
    await number.fill('7.5');
    await number.blur();
    await expect(number).toHaveValue('7.50');
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(numbers.nth(0)).toHaveValue('7.50');
    await expect(numbers.nth(1)).toHaveValue('7.50');
    await expect(table.getByPlaceholder('请输入价格', { exact: true }).nth(0)).toHaveValue('10.00');
    await expect(table.getByPlaceholder('请输入价格', { exact: true }).nth(1)).toHaveValue('20.00');
    await expect(table.locator('.quantity-editor input').nth(0)).toHaveValue('2');
    await expect(table.locator('.quantity-editor input').nth(1)).toHaveValue('3');
    await page.getByRole('button', { name: '批量填写', exact: true }).click();
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(numbers.nth(0)).toHaveValue('7.50');
    await expect(numbers.nth(1)).toHaveValue('7.50');
    expect(writes).toHaveLength(0);
  });

  test('layered numeric attributes reject precision before replacing any specifications', async ({ page }) => {
    const { table, writes } = await openEditor(page, resource, install);
    await page.getByRole('button', { name: '编辑规格', exact: true }).click();
    const dialog = await switchToLayered(page);
    await dialog.locator('.spec-attr-tag').getByText('销售数字属性', { exact: true }).click();
    const number = dialog.getByPlaceholder('请输入销售数字属性', { exact: true });
    await number.fill('3.456');
    await expect(number).toHaveValue('');
    await number.fill('.');
    await dialog.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('请输入数字', { exact: true })).toBeVisible();
    await expectNativeError(number);
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.getByPlaceholder('请输入价格', { exact: true }).nth(0)).toHaveValue('10.00');
    await number.fill('3.5');
    await number.blur();
    await expect(number).toHaveValue('3.50');
    await dialog.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(table.locator('tbody tr')).toContainText('3.50');
    await expect(table.getByPlaceholder('请输入价格', { exact: true })).toHaveValue('');
    expect(writes).toHaveLength(0);
  });

  test('unchanged legacy layered values preserve SKU data while new combinations cannot inherit their exemption', async ({
    page,
  }) => {
    const { table, writes } = await openEditor(page, resource, install, true);
    await page.getByRole('button', { name: '编辑规格', exact: true }).click();
    const dialog = page.locator('.spec-dialog');
    await dialog.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.getByPlaceholder('请输入价格', { exact: true }).nth(0)).toHaveValue('10.00');
    await expect(table.getByPlaceholder('请输入价格', { exact: true }).nth(1)).toHaveValue('20.00');
    await page.getByRole('button', { name: '编辑规格', exact: true }).click();
    const choices = dialog.locator('.spec-group').filter({ hasText: '销售选项属性' });
    await choices.getByRole('button', { name: '新增属性值', exact: true }).click();
    await choices.getByPlaceholder('请选择销售选项属性', { exact: true }).last().click();
    await page.getByRole('listitem', { name: '选项3', exact: true }).click();
    await dialog.getByRole('button', { name: /^确认(?:新增|保存)$/, exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('最多输入两位小数', { exact: true })).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(2);
    expect(writes).toHaveLength(0);
  });
  test('long attribute labels retain concise feedback completely above the batch drawer footer', async ({ page }) => {
    const label = '较长的数字属性名称'.repeat(6);
    await openEditor(page, resource, install, false, label);
    await page.getByRole('button', { name: '批量填写', exact: true }).click();
    const drawer = page.locator('.t-drawer--open').filter({ hasText: '批量填写' });
    const input = drawer.getByPlaceholder(`请输入${label}`, { exact: true });
    const before = await input.boundingBox();
    await input.fill('文本');
    await expect(input).toHaveValue('');
    await input.fill('.');
    await input.blur();
    await drawer.getByRole('button', { name: '确认保存', exact: true }).click();
    const tip = drawer.getByText('请输入数字', { exact: true });
    await expect(tip).toBeVisible();
    await expectNativeError(input);
    expect(
      await tip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const footer = element.closest('.t-drawer')!.querySelector('.t-drawer__footer')!.getBoundingClientRect();
        return {
          wrapped: box.height > parseFloat(getComputedStyle(element).lineHeight),
          complete: element.scrollWidth <= element.clientWidth,
          aboveFooter: box.bottom <= footer.top,
        };
      }),
    ).toEqual({ wrapped: false, complete: true, aboveFooter: true });
    const cardSpacing = await tip.evaluate((element) => {
      const body = element.closest('.t-card__body')!;
      return {
        gap: body.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom,
        padding: parseFloat(getComputedStyle(body).paddingBottom),
      };
    });
    expect(cardSpacing.padding).toBeGreaterThan(0);
    expect(cardSpacing.gap).toBeGreaterThanOrEqual(cardSpacing.padding - 1);
    const after = await input.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
  });
  test('batch range title stays centered on the first tag line after options wrap', async ({ page }) => {
    await openEditor(page, resource, install, false, '销售数字属性', 60);
    await page.getByRole('button', { name: '批量填写', exact: true }).click();
    const drawer = page.locator('.t-drawer--open').filter({ hasText: '批量填写' });
    const row = drawer.locator('.batch-filter-row').first();
    const geometry = await row.evaluate((element) => {
      const label = element.querySelector('.batch-filter-label')!.getBoundingClientRect();
      const values = element.querySelector('.batch-filter-values')!;
      const tags = Array.from(values.querySelectorAll('.t-tag')).map((tag) => tag.getBoundingClientRect());
      const first = tags[0]!;
      const lines = [...new Set(tags.map((tag) => Math.round(tag.top)))].sort((a, b) => a - b);
      return {
        labelCenter: label.top + label.height / 2,
        firstCenter: first.top + first.height / 2,
        lineGaps: lines.slice(1).map((top, index) => top - lines[index]! - first.height),
        expectedGap: parseFloat(getComputedStyle(values).rowGap),
        lines: lines.length,
      };
    });
    expect(geometry.lines).toBeGreaterThanOrEqual(3);
    expect(Math.abs(geometry.labelCenter - geometry.firstCenter)).toBeLessThanOrEqual(1);
    for (const gap of geometry.lineGaps) expect(Math.abs(gap - geometry.expectedGap)).toBeLessThanOrEqual(1);
    await expect(row.locator('.t-tag').first()).toHaveText('全部');
    await expect(row.locator('.t-tag')).toHaveCount(61);
  });
  for (const client of ['supply-chain', 'admin']) {
    test(`${client} batch range titles use the longest unwrapped label and align option columns`, async ({ page }) => {
      const { writes } = await openEditor(page, resource, install, true, '配件专属销售属性2（共享）', 2, client);
      await page.getByRole('button', { name: '批量填写', exact: true }).click();
      const drawer = page.locator('.t-drawer--open').filter({ hasText: '批量填写' });
      const rows = await drawer.locator('.batch-filter-row').evaluateAll((elements) =>
        elements.map((element) => {
          const label = element.querySelector('.batch-filter-label')!;
          const values = element.querySelector('.batch-filter-values')!.getBoundingClientRect();
          const tag = element.querySelector('.t-tag')!.getBoundingClientRect();
          const box = label.getBoundingClientRect();
          return {
            labelWidth: box.width,
            labelHeight: box.height,
            lineHeight: parseFloat(getComputedStyle(label).lineHeight),
            complete: label.scrollWidth <= label.clientWidth,
            optionLeft: values.left,
            centered: Math.abs(box.top + box.height / 2 - tag.top - tag.height / 2),
          };
        }),
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.labelWidth).toBeGreaterThan(100);
      expect(rows[0]!.labelWidth).toBe(rows[1]!.labelWidth);
      expect(rows[0]!.optionLeft).toBe(rows[1]!.optionLeft);
      for (const row of rows) {
        expect(row.complete).toBe(true);
        expect(row.labelHeight).toBe(row.lineHeight);
        expect(row.centered).toBeLessThanOrEqual(1);
      }
      expect(writes).toHaveLength(0);
    });
  }
}
