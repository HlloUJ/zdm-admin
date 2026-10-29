import { productWarehouseUrl } from './product-test-navigation';
import { expect, test } from '@playwright/test';

import { installAdminApiMocks, setMockBusinessClient } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: window.localStorage.getItem('zdm-e2e-client') ?? 'admin',
        name: '韩健',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await installAdminApiMocks(page);
});

test('keeps foundation pagination spacing consistent inside list layouts', async ({ page }) => {
  await page.goto(productWarehouseUrl('/product-attribute'));

  const styles = await page.locator('.zdm-admin-list-layout__pagination').evaluate((host) => {
    const pagination = host.querySelector<HTMLElement>('.zdm-admin-pagination');
    if (!pagination) return null;

    const hostStyle = getComputedStyle(host);
    const paginationStyle = getComputedStyle(pagination);
    return {
      hostMarginTop: hostStyle.marginTop,
      hostPadding: hostStyle.padding,
      paginationDisplay: paginationStyle.display,
      paginationJustifyContent: paginationStyle.justifyContent,
      paginationMarginTop: paginationStyle.marginTop,
      paginationWidth: paginationStyle.width,
      hostWidth: `${host.clientWidth - parseFloat(hostStyle.paddingLeft) - parseFloat(hostStyle.paddingRight)}px`,
    };
  });

  expect(styles).toEqual({
    hostMarginTop: '0px',
    hostPadding: '16px',
    paginationDisplay: 'flex',
    paginationJustifyContent: 'flex-end',
    paginationMarginTop: '0px',
    paginationWidth: styles?.hostWidth,
    hostWidth: styles?.hostWidth,
  });
});

test('uses the official TDesign pagination controls on routed list pages', async ({ page }) => {
  const routes = [
    '/finished-stock-management',
    '/finished-stock-craft',
    '/employee-management',
    '/role-management',
    '/slab-management',
    '/supplier-management',
    '/tenant-management',
    '/tenant-store-management',
  ];

  for (const route of routes) {
    await setMockBusinessClient(page, route === '/supplier-management' ? 'supply-chain' : 'admin');
    await page.goto(productWarehouseUrl(route));
    const pagination = page.locator('.zdm-admin-pagination:visible .t-pagination');
    await expect(pagination).toBeVisible();
    await expect(page.locator('.custom-pagination')).toHaveCount(0);

    const controlHeight = await pagination
      .locator('.t-pagination__btn-next')
      .evaluate((control) => Math.round(control.getBoundingClientRect().height));
    expect(controlHeight).toBe(32);
  }
});

test('matches the independent official filter grid and native pagination padding', async ({ page, context }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await setMockBusinessClient(page, 'supply-chain');
  await page.goto(productWarehouseUrl('/supplier-management'));
  const form = page.locator('.zdm-admin-filter-form');
  await expect(form).toBeVisible();
  const formWidth = (await form.boundingBox())!.width;
  const reference = await context.newPage();
  await reference.goto(productWarehouseUrl('/tests/fixtures/official-ui/reference.html'));
  await reference.locator('.list-common-table').evaluate((host, width) => {
    (host as HTMLElement).style.width = `${width + 64}px`;
    (host as HTMLElement).style.boxSizing = 'border-box';
  }, formWidth);
  const measurements = (root: Element) => {
    const left = root.getBoundingClientRect().left;
    return Array.from(root.querySelectorAll('.t-form__item'))
      .slice(0, 2)
      .map((item) => {
        const label = item.querySelector('.t-form__label')!;
        const control = item.querySelector('.t-form__controls')!;
        return {
          labelLeft: label.getBoundingClientRect().left - left,
          labelWidth: label.getBoundingClientRect().width,
          controlLeft: control.getBoundingClientRect().left - left,
          controlWidth: control.getBoundingClientRect().width,
        };
      });
  };
  const actual = await form.evaluate(measurements);
  const expected = await reference.locator('.list-common-table > .t-form').evaluate(measurements);
  actual.forEach((item, index) => {
    for (const key of Object.keys(item) as (keyof typeof item)[]) {
      expect(item[key], `${index}: ${key}`).toBeCloseTo(expected[index]![key], 0);
    }
  });
  const nativePadding = await reference.locator('.t-table__pagination').evaluate((el) => getComputedStyle(el).padding);
  await expect(page.locator('.table-card > .zdm-admin-pagination')).toHaveCSS('padding', nativePadding);
  const filterBottom = (await page.locator('.filter-card').boundingBox())!;
  const tableTop = (await page.locator('.table-card').boundingBox())!;
  expect(tableTop.y).toBeCloseTo(filterBottom.y + filterBottom.height, 0);
  await reference.close();
});

test('searches slabs by name, id, or SKU with the shared filter on every status tab', async ({ page }) => {
  await page.route('**/api/admin/slab-markup-configurations/options', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'ok', data: [] }),
    });
  });
  await page.goto(productWarehouseUrl('/slab-management'));
  const keywordInput = page.locator('.slab-keyword-filter').getByPlaceholder('请输入大板名称/ID/编号', { exact: true });
  expect((await page.locator('.slab-keyword-filter').boundingBox())!.width).toBeGreaterThan(200);
  await expect(page.locator('.filter-fields .t-form__label')).toHaveText([
    '大板：',
    '品种：',
    '入库类型：',
    '入库人：',
    '产地：',
    '纹理：',
    '色系：',
    '等级：',
    '供应商：',
  ]);
  const filterGap = await page.locator('.filter-fields').evaluate((element) => {
    const styles = getComputedStyle(element);
    return { columnGap: styles.columnGap, rowGap: styles.rowGap };
  });
  expect(filterGap).toEqual({ columnGap: '0px', rowGap: '24px' });
  const keywordBox = (await page.locator('.slab-keyword-filter').boundingBox())!;
  const supplierBox = (await page.locator('.supplier-filter').boundingBox())!;
  const searchBox = (await page.getByRole('button', { name: '查询', exact: true }).boundingBox())!;
  const queryColumns = await page
    .locator('.filter-fields')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const firstRowPeer = await page
    .locator('.filter-fields .t-form__item')
    .nth(8 % queryColumns)
    .boundingBox();
  expect(supplierBox.x).toBeCloseTo(firstRowPeer!.x, 0);
  expect(supplierBox.y).toBeGreaterThan(keywordBox.y);
  expect(searchBox.y).toBeCloseTo(keywordBox.y, 0);
  const supplierControl = (await page.locator('.supplier-filter .t-input').boundingBox())!;
  expect(searchBox.x).toBeGreaterThan(supplierControl.x + supplierControl.width);

  for (const tabLabel of ['仓库中 1', '已上架', '已售完', '回收站 2']) {
    await page.getByText(tabLabel, { exact: true }).click();
    await expect(keywordInput).toBeVisible();
  }

  await page.getByText('仓库中 1', { exact: true }).click();
  for (const keyword of ['雪花白大板', '6', 'SLAB-E2E-006']) {
    await keywordInput.fill(keyword);
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row', { name: /雪花白大板 06/ })).toBeVisible();
  }

  await page.getByText('回收站 2', { exact: true }).click();
  await keywordInput.fill('SLAB-E2E-008');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByRole('row', { name: /回收站大板 08/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /回收站大板 07/ })).toHaveCount(0);
});

for (const client of ['admin', 'supply-chain'] as const) {
  test(`${client} slab filters follow their configured grid and right-hand actions`, async ({ page }) => {
    await setMockBusinessClient(page, client);
    await page.goto(productWarehouseUrl(client === 'admin' ? '/slab-management' : '/supply-chain/slab-management'));
    const sizes = [
      [1920, 4],
      [1689, 4],
      [1393, 3],
      [1100, 2],
    ];
    for (const [width, columns] of sizes) {
      await page.setViewportSize({ width, height: 1080 });
      for (const tab of ['仓库中', '已上架']) {
        await page
          .locator('.status-tabs')
          .getByText(new RegExp(`^${tab}(?: [0-9]+)?$`))
          .click();
        const fields = page.locator('.filter-fields');
        const items = fields.locator('.t-form__item');
        await expect(items).toHaveCount(tab === '仓库中' ? 9 : 7);
        const boxes = await items.evaluateAll((elements) =>
          elements.map((el) => {
            const { x, y, width } = el.getBoundingClientRect();
            return { x, y, width };
          }),
        );
        expect(
          await fields.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
          `${client} viewport ${width}; fields ${(await fields.boundingBox())!.width}`,
        ).toBe(columns);
        for (let index = 0; index < boxes.length; index++) {
          expect(boxes[index].x).toBeCloseTo(boxes[index % columns].x, 0);
          expect(boxes[index].y).toBeCloseTo(boxes[Math.floor(index / columns) * columns].y, 0);
          if (index >= columns) expect(boxes[index].y).toBeGreaterThan(boxes[index - columns].y);
        }
        for (const box of boxes) expect(box.width).toBeCloseTo(boxes[0].width, 0);
        const row = page.locator('.filter-row');
        const ratio = await row.evaluate((el) => {
          const columns = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat);
          return columns[0] / columns[1];
        });
        expect(ratio).toBeCloseTo(5, 1);
        {
          const lastControlBottom = await fields
            .locator('.t-form__controls')
            .evaluateAll((controls) => Math.max(...controls.map((control) => control.getBoundingClientRect().bottom)));
          const toolbar = (await page.locator('.table-toolbar').boundingBox())!;
          expect(toolbar.y - lastControlBottom).toBeCloseTo(24, 0);
          const actions = row.locator('.filter-actions');
          const actionWidth = (await actions.boundingBox())!.width;
          const buttons = await actions.locator('.t-button').all();
          const buttonWidth = (await buttons[0].boundingBox())!.width + (await buttons[1].boundingBox())!.width;
          expect(actionWidth).toBeGreaterThanOrEqual(buttonWidth + 8);
          const actionBox = (await actions.boundingBox())!;
          const resetBox = (await buttons[1].boundingBox())!;
          expect(resetBox.x + resetBox.width).toBeCloseTo(actionBox.x + actionBox.width, 0);
          if (boxes.length > columns) {
            const first = (await items.first().locator('.t-form__controls').boundingBox())!;
            const next = (await items.nth(columns).locator('.t-form__controls').boundingBox())!;
            expect(next.y - first.y - first.height).toBeCloseTo(24, 0);
          }
        }
        const search = (await row.getByRole('button', { name: '查询', exact: true }).boundingBox())!;
        expect(search.y).toBeCloseTo(boxes[0].y, 0);
        const lastControl = (await items
          .nth(columns - 1)
          .locator('.t-form__controls')
          .boundingBox())!;
        expect(search.x).toBeGreaterThan(lastControl.x + lastControl.width);
        if (tab === '仓库中') {
          await expect(fields.locator('.off-shelf-date-filter')).toHaveCount(0);
          for (const input of await fields.locator('.t-form__controls').all()) {
            expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(134);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  });
}

test('orders the requested management lists by creation time descending', async ({ page }) => {
  const cases = [
    {
      path: '/slab-variety',
      endpoint: '**/api/admin/slab-varieties',
      newerName: '较新品种',
      records: [
        { id: 101, name: '较早品种', status: 'enabled', createdAt: '2026-08-01T09:00:00' },
        { id: 102, name: '较新品种', status: 'enabled', createdAt: '2026-08-03T09:00:00' },
      ],
    },
    {
      path: '/finished-stock-craft',
      endpoint: '**/api/admin/crafts',
      newerName: '较新工艺',
      records: [
        { id: 201, name: '较早工艺', type: '边工艺', status: 'enabled', createdAt: '2026-08-01T09:00:00' },
        { id: 202, name: '较新工艺', type: '边工艺', status: 'enabled', createdAt: '2026-08-03T09:00:00' },
      ],
    },
    {
      path: '/employee-management',
      endpoint: /\/api\/admin\/employees(?:\?.*)?$/,
      newerName: '较新员工',
      records: [
        {
          id: 301,
          name: '较早员工',
          gender: 'male',
          phone: '15900000301',
          status: 'enabled',
          roleIds: '2',
          dataPermission: 'all',
          createdAt: '2026-08-01T09:00:00',
        },
        {
          id: 302,
          name: '较新员工',
          gender: 'female',
          phone: '15900000302',
          status: 'enabled',
          roleIds: '2',
          dataPermission: 'all',
          createdAt: '2026-08-03T09:00:00',
        },
      ],
    },
    {
      path: '/role-management',
      endpoint: /\/api\/admin\/roles(?:\?.*)?$/,
      newerName: '较新角色',
      records: [
        {
          id: 401,
          name: '较早角色',
          code: 'OLDER_ROLE',
          category: 'operation-platform',
          clientCode: 'admin',
          dataScope: 'all',
          status: 'enabled',
          functionPermissions: '',
          createdAt: '2026-08-01T09:00:00',
        },
        {
          id: 402,
          name: '较新角色',
          code: 'NEWER_ROLE',
          category: 'operation-platform',
          clientCode: 'admin',
          dataScope: 'all',
          status: 'enabled',
          functionPermissions: '',
          createdAt: '2026-08-03T09:00:00',
        },
      ],
    },
  ];

  for (const item of cases) {
    await page.unroute(item.endpoint);
    await page.route(item.endpoint, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: 'ok', data: item.records }),
      }),
    );

    await page.goto(productWarehouseUrl(item.path));
    await expect(page.getByRole('main').locator('tbody tr').first()).toContainText(item.newerName);
  }
});

test('opens tenant create, business and edit dialogs', async ({ page }) => {
  await page.goto(productWarehouseUrl('/tenant-management'));
  const main = page.getByRole('main');

  await expect(main.locator('.page-header')).toHaveCount(0);
  await expect(main.getByText('运营中', { exact: true })).toBeVisible();
  await expect(main.getByText('已归档', { exact: true })).toBeVisible();
  await expect(main.getByText('状态', { exact: true })).toHaveCount(0);
  await expect(main.getByText('装点猫直营租户')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog:visible').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('租户姓名')).toBeVisible();
  await expect(createDialog.getByText('联系方式')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const tenantRow = page.locator('tbody tr').filter({ hasText: '装点猫直营租户' }).first();
  await tenantRow.getByText('业务开通').click();
  const businessDialog = page.locator('.t-dialog:visible').filter({ hasText: '业务开通' });
  await expect(businessDialog).toBeVisible();
  await expect(businessDialog.getByText('城市合伙人')).toBeVisible();
  await expect(businessDialog.getByText('大板供应商')).toBeVisible();
  await businessDialog.getByRole('button', { name: '取消' }).click();
  await expect(businessDialog).toBeHidden();

  await tenantRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫直营租户');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('gates tenant actions by status and requires the exact name before permanent deletion', async ({ page }) => {
  await page.goto(productWarehouseUrl('/tenant-management'));

  const enabledRow = page.locator('tbody tr').filter({ hasText: '装点猫直营租户' });
  await expect(enabledRow.getByText('业务开通', { exact: true })).toBeVisible();
  await expect(enabledRow.getByText('编辑', { exact: true })).toBeVisible();
  await expect(enabledRow.getByText('归档', { exact: true })).toBeVisible();
  await expect(enabledRow.getByText('彻底删除', { exact: true })).toHaveCount(0);

  await page.getByText('已归档', { exact: true }).click();
  const disabledRow = page.locator('tbody tr').filter({ hasText: '临时归档租户' });
  await expect(disabledRow.getByText('业务开通', { exact: true })).toHaveCount(0);
  await expect(disabledRow.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(disabledRow.getByText('恢复运营', { exact: true })).toBeVisible();
  await disabledRow.getByText('彻底删除', { exact: true }).click();

  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '彻底删除租户' });
  await expect(dialog).toContainText('门店2');
  await expect(dialog).toContainText('员工5');
  await expect(dialog).toContainText('删除独立账号4');
  await expect(dialog).toContainText('保留账号（共享或历史引用）1');
  await expect(dialog).toContainText('释放手机号4');
  const confirmButton = dialog.getByRole('button', { name: '确认彻底删除', exact: true });
  await expect(confirmButton).toBeDisabled();
  await dialog.getByPlaceholder('请输入租户名称').fill('错误名称');
  await expect(confirmButton).toBeDisabled();
  await dialog.getByPlaceholder('请输入租户名称').fill('临时归档租户');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText('已彻底删除“临时归档租户”', { exact: true })).toBeVisible();
});

test('opens store create, level and edit dialogs', async ({ page }) => {
  await page.goto(productWarehouseUrl('/tenant-store-management'));
  const main = page.getByRole('main');

  await expect(main.locator('.page-header')).toHaveCount(0);
  await expect(main.getByText('杭州体验门店')).toBeVisible();
  await expect(main.getByText('状态', { exact: true })).toHaveCount(0);
  const tableHeaders = main.locator('thead th');
  await expect(tableHeaders.nth(7)).toContainText('创建人');
  await expect(tableHeaders.nth(8)).toContainText('创建时间');
  await expect(page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first()).toContainText('韩健');

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog:visible').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('选择租户')).toBeVisible();
  await expect(createDialog.getByText('门店类型')).toBeVisible();
  await expect(createDialog.getByText('门店地址')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const storeRow = page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first();
  await storeRow.locator('.level-cell').hover();
  await storeRow.getByLabel('修改门店级别').click();
  const levelDialog = page.locator('.t-dialog:visible').filter({ hasText: '门店级别' });
  await expect(levelDialog).toBeVisible();
  await expect(levelDialog.getByText('门店级别').first()).toBeVisible();
  await levelDialog.getByRole('button', { name: '取消' }).click();
  await expect(levelDialog).toBeHidden();

  await storeRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('杭州体验门店');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('opens supplier create and edit dialogs', async ({ page }) => {
  await setMockBusinessClient(page, 'supply-chain');
  await page.goto(productWarehouseUrl('/supplier-management'));
  const main = page.getByRole('main');

  await expect(main.locator('.page-header')).toHaveCount(0);
  await expect(main.getByText('装点猫大板供应商')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog:visible').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('供应商名称')).toBeVisible();
  await expect(createDialog.getByText('供货类型', { exact: true })).toBeVisible();
  await expect(createDialog.getByText('联系电话')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const supplierRow = page.locator('tbody tr').filter({ hasText: '装点猫大板供应商' }).first();
  await expect(supplierRow.getByText('韩健', { exact: true })).toBeVisible();
  await supplierRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫大板供应商');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

for (const route of [
  '/employee-management',
  '/finished-stock-craft',
  '/product-category',
  '/product-attribute',
  '/product-attribute-value',
  '/markup-configuration',
  '/tenant-management',
  '/tenant-store-management',
  '/store-level-management',
  '/slab-management',
  '/finished-stock-management',
  '/supplier-supply-type-management',
  '/supplier-management',
  '/slab-variety',
  '/slab-origin',
  '/slab-texture',
  '/slab-color',
  '/slab-grade',
]) {
  test(`uses consistent label and condition spacing across list filters: ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 1393, height: 868 });
    await setMockBusinessClient(page, route === '/supplier-management' ? 'supply-chain' : 'admin');
    await page.goto(productWarehouseUrl(route));
    const fields = page
      .locator('.zdm-admin-filter-form .filter-fields, .zdm-admin-filter-form .supply-type-filter-fields')
      .first();
    await expect(fields).toBeVisible();
    const result = await fields.evaluate((root) => {
      const items = Array.from(root.querySelectorAll<HTMLElement>('.t-form__item'));
      return items.map((item) => {
        const label = item.querySelector<HTMLElement>('.t-form__label')!;
        const control = item.querySelector<HTMLElement>('.t-form__controls')!;
        const labelBox = label.getBoundingClientRect();
        const controlBox = control.getBoundingClientRect();
        return {
          gap: controlBox.left - labelBox.right + parseFloat(getComputedStyle(label).paddingRight),
          width: controlBox.width,
          statusFilter: item.classList.contains('zdm-status-filter'),
          groupGap: getComputedStyle(
            item.closest('.filter-primary-row, .filter-secondary-row, .filter-fields, .supply-type-filter-fields')!,
          ).columnGap,
        };
      });
    });
    for (const item of result) {
      expect(item.gap, route).toBeCloseTo(24, 0);
      expect(item.groupGap, route).toBe('0px');
      expect(item.width, route).toBeGreaterThan(40);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
  });
}

test('resets category browsing and keeps the four-level filter popup stable', async ({ page }) => {
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.setViewportSize({ width: 1393, height: 868 });
  await page.goto(productWarehouseUrl('/finished-stock-management'));
  const category = page.locator('.filter-fields .t-form__item').nth(1);
  await category.locator('.t-input').click();
  const panel = page.locator('.t-cascader__panel:visible');
  await expect(panel).toBeVisible();
  const initial = await panel.boundingBox();
  await panel.getByText('成品现货', { exact: true }).hover();
  await panel.getByText('餐桌', { exact: true }).hover();
  await panel.getByText('石材餐桌', { exact: true }).hover();
  await expect(panel.getByText('奢石餐桌', { exact: true })).toBeVisible();
  const expanded = await panel.boundingBox();
  expect(Math.abs(expanded!.x - initial!.x)).toBeLessThan(2);
  expect(initial!.width).toBeLessThan(250);
  expect(expanded!.width).toBeGreaterThan(initial!.width * 3);
  await panel.getByText('奢石餐桌', { exact: true }).click();
  await expect(category).toContainText('奢石餐桌');
  await expect(category).not.toContainText('成品现货 /');
  await category.locator('.t-input').click();
  await expect(panel.getByText('成品现货', { exact: true })).toBeVisible();
  await expect(panel.getByText('餐桌', { exact: true })).toHaveCount(0);
  await page.getByRole('columnheader', { name: '商品主图', exact: true }).click();
  await expect(category).toContainText('奢石餐桌');
  await category.locator('.t-input').hover();
  await category.locator('.t-input__suffix-clear').click();
  await expect(category).not.toContainText('奢石餐桌');
});

test('keeps slab filters inside the card across status tabs', async ({ page }) => {
  await page.setViewportSize({ width: 1393, height: 868 });
  await page.goto(productWarehouseUrl('/slab-management'));
  for (const tab of ['仓库中', '已上架', '已售完', '回收站']) {
    await page
      .locator('.status-tabs')
      .getByText(new RegExp(`^${tab}(?: [0-9]+)?$`))
      .click();
    const fields = page.locator('.filter-fields');
    const overflow = await fields.evaluate((host) => {
      const right = host.getBoundingClientRect().right;
      return Array.from(host.querySelectorAll('.t-form__controls, .filter-actions > .t-button')).some(
        (item) => item.getBoundingClientRect().right > right + 1,
      );
    });
    expect(overflow, tab).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab).toBe(true);
    if (tab === '仓库中') {
      await expect(fields.locator('.t-form__label')).toHaveText([
        '大板：',
        '品种：',
        '入库类型：',
        '入库人：',
        '产地：',
        '纹理：',
        '色系：',
        '等级：',
        '供应商：',
      ]);
    } else {
      await expect(fields.locator('.t-form__label')).toHaveText([
        '大板：',
        '品种：',
        '产地：',
        '纹理：',
        '色系：',
        '等级：',
        '供应商：',
      ]);
    }
  }
});

test('shows warehouse actor and retained down-shelf reason instead of creator metadata', async ({ page }) => {
  await page.route('**/api/admin/finished-products/attribute-template-options', (route) =>
    route.fulfill({ json: { code: 0, data: [] } }),
  );
  await page.route('**/api/admin/finished-products', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 71,
            name: '下架展示测试商品',
            sku: 'OFF-71',
            status: 'warehouse',
            createdByName: '商品创建者',
            createdAt: '2026-07-01T01:00:00',
            stateOperatorName: '实际下架人',
            stateOperatedAt: '2026-09-17T02:00:00Z',
            warehouseEntryType: 'offShelf',
            warehouseEntryReason: '商品信息有误',
            warehouseEntryDetail: '待核对尺寸',
          },
        ],
      },
    }),
  );
  await page.goto(productWarehouseUrl('/finished-stock-management'));
  await page
    .locator('.status-tabs')
    .getByText(/^仓库中(?: [0-9]+)?$/)
    .click();
  const headers = await page.locator('thead th').allTextContents();
  expect(headers.join('|')).toContain('入库类型 / 详细说明|入库人|入库时间');
  expect(headers.join('|')).not.toContain('创建人');
  expect(headers.join('|')).not.toContain('创建时间');
  const row = page.locator('tbody tr').filter({ hasText: '下架展示测试商品' });
  await expect(row).toContainText('实际下架人');
  await expect(row).toContainText('2026/09/17 10:00');
  await expect(row).not.toContainText('商品创建者');
});

test('does not add empty-cell padding to the finished stock horizontal scroll width', async ({ page }) => {
  await page.setViewportSize({ width: 1393, height: 868 });
  await page.route('**/api/admin/finished-products', (route) => route.fulfill({ json: { code: 0, data: [] } }));
  await page.goto(productWarehouseUrl('/finished-stock-management'));
  for (const tab of ['仓库中', '已上架', '已售完', '回收站']) {
    await page.locator('.status-tabs').getByText(tab, { exact: true }).click();
    const table = page.locator('.finished-stock-table');
    await expect(table.getByText('暂无数据')).toBeVisible();
    const sizes = await table.evaluate((root) => {
      const content = root.querySelector('.t-table__content')!;
      const grid = root.querySelector('table')!;
      const empty = root.querySelector('.t-table__empty')!;
      return {
        scrollWidth: content.scrollWidth,
        expectedWidth: Math.max(content.clientWidth, Math.ceil(grid.getBoundingClientRect().width)),
        emptyLeft: empty.getBoundingClientRect().left,
        contentLeft: content.getBoundingClientRect().left,
      };
    });
    expect(sizes.scrollWidth, tab).toBeLessThanOrEqual(sizes.expectedWidth + 1);
    expect(sizes.emptyLeft, tab).toBeCloseTo(sizes.contentLeft, 0);
    if (tab === '仓库中') {
      const operation = table.locator('thead th').last();
      await expect
        .poll(async () => {
          const header = await operation.boundingBox();
          const content = await table.locator('.t-table__content').boundingBox();
          return Math.abs(header!.x + header!.width - content!.x - content!.width);
        })
        .toBeLessThan(1);
      const before = await operation.boundingBox();
      await table.locator('.t-table__content').evaluate((node) => {
        node.scrollLeft = node.scrollWidth;
      });
      await expect
        .poll(() => table.locator('.t-table__content').evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(0);
      expect((await operation.boundingBox())!.x).toBeCloseTo(before!.x, 0);
    }
  }
});
