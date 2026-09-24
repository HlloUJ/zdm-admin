import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

const scope = (state: string) => ({ offShelf: 'off-shelf', soldOut: 'sold-out' })[state] || state;
const prefix = 'admin.slab-management.';
const sourceBlockMessage = (source: string) =>
  source === 'purged'
    ? '该商品已被供应链彻底删除'
    : source === 'recycle'
      ? '该商品已被供应链删除至回收站'
      : '该商品已被供应链下架';
async function setup(page: Page, status: string, sourceStatus = 'selling', detail = true) {
  await installAdminApiMocks(page);
  const permissions = [prefix + scope(status) + '.view', prefix + 'recycle.purge'];
  if (detail) permissions.push(prefix + scope(status) + '.detail');
  await page.addInitScript((permissions) => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 2,
        clientCode: 'admin',
        name: '大板验收',
        roles: ['OPERATOR'],
        permissions,
        dataPermission: 'all',
      }),
    );
  }, permissions);
  const record = {
    id: 99601,
    name: '协同大板',
    serialNo: 'SLAB-COLLAB',
    status,
    sourceStatus,
    sourceUnavailable: !['selling', 'soldOut'].includes(sourceStatus),
    sourceMessage: !['selling', 'soldOut'].includes(sourceStatus) ? sourceBlockMessage(sourceStatus) : null,
    stock: 2,
    costPrice: 10,
    lengthMm: 3000,
    widthMm: 1500,
    thicknessMm: 20,
    createdAt: '2026-09-21T09:00:00',
    offShelfRecords: [],
  };
  await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: [record] } }));
  await page.route('**/api/admin/slabs/99601', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          ...record,
          name: '最新协同大板',
          sourceOffShelfRecords: [{ id: 1, standardReason: '库存异常', detailReason: '待核对库存' }],
        },
      },
    }),
  );
  await page.route('**/api/admin/slabs/action-check', (route) => route.fulfill({ json: { code: 0, data: true } }));
  await page.goto('/slab-management');
  await expect(page.getByRole('main').getByText('协同大板', { exact: true })).toBeVisible();
}
for (const status of ['warehouse', 'selling', 'offShelf', 'soldOut', 'recycle']) {
  test(`运营 ${status} 详情读取最新数据且不提供编辑`, async ({ page }) => {
    await setup(page, status);
    await page.getByRole('main').locator('.table-actions').getByText('详情', { exact: true }).click();
    const drawer = page.locator('.t-drawer:visible');
    await expect(drawer.getByText('最新协同大板', { exact: true })).toBeVisible();
    await expect(drawer.getByText('库存异常', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('待核对库存', { exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  });
}
for (const source of ['offShelf', 'recycle', 'purged', 'warehouse']) {
  test(`来源 ${source} 遮罩与成品现货一致并允许只读详情`, async ({ page }) => {
    await setup(page, 'selling', source);
    const main = page.getByRole('main');
    const overlay = main.locator('.source-unavailable-overlay');
    await expect(overlay).toContainText(sourceBlockMessage(source));
    await expect(overlay.getByRole('button')).toHaveText(['详情', '彻底删除']);
    await expect(main.locator('tr[data-source-id="99601"]')).toHaveAttribute('inert', '');
    await expect(main.locator('tr[data-source-id="99601"] input[type="checkbox"]')).toBeDisabled();
    await overlay.getByRole('button', { name: '详情', exact: true }).click();
    await expect(page.locator('.t-drawer:visible').getByText('最新协同大板', { exact: true })).toBeVisible();
  });
}
test('无详情权限时普通行与遮罩都不显示详情', async ({ page }) => {
  await setup(page, 'selling', 'offShelf', false);
  const overlay = page.getByRole('main').locator('.source-unavailable-overlay');
  await expect(overlay.getByRole('button')).toHaveText(['彻底删除']);
  await expect(page.getByRole('main').locator('.table-actions').getByText('详情', { exact: true })).toHaveCount(0);
});

test('运营角色候选目录五个状态均显示详情且默认不勾选', async ({ page }) => {
  await setup(page, 'warehouse');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions = ['all'];
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  await page.route(/\/api\/admin\/roles(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 2,
            name: '大板运营角色',
            code: 'SLAB_DETAIL_TEST',
            clientCode: 'admin',
            createdByClientCode: 'admin',
            dataScope: 'all',
            status: 'enabled',
            functionPermissions: prefix + 'warehouse.view',
          },
        ],
      },
    }),
  );
  await page.goto('/role-management');
  await page.locator('tbody tr').filter({ hasText: '大板运营角色' }).getByText('权限', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '权限配置' });
  await dialog.locator('.permission-module-list').getByText('商品管理', { exact: true }).click();
  const rows = dialog.locator('.permission-matrix tbody tr');
  const first = rows.filter({ hasText: '大板管理页' }).first();
  const index = await first.evaluate((el) => Array.from(el.parentElement!.children).indexOf(el));
  for (const [offset, label] of ['仓库中', '已上架', '已下架', '已售完', '回收站'].entries()) {
    const row = rows.nth(index + offset + 1);
    await expect(row.locator('.permission-tab-text')).toHaveText(label);
    await expect(row.getByRole('checkbox', { name: '详情', exact: true })).not.toBeChecked();
  }
});

test('操作时来源已下架会刷新遮罩并清除旧选择', async ({ page }) => {
  await setup(page, 'selling');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions.push('admin.slab-management.selling.off-shelf');
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  await page.reload();
  await page.getByRole('main').locator('tbody tr').first().locator('.t-checkbox').click();
  await expect(page.locator('.selection-info')).toContainText('已选 1 项');
  await page.getByRole('main').locator('.table-actions').getByText('下架', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await dialog.locator('.t-select').click();
  await page.getByText('库存异常', { exact: true }).last().click();
  await page.route('**/api/admin/slabs/batch-status', (route) =>
    route.fulfill({ status: 400, json: { code: 400, message: '来源商品未上架或已删除，只能彻底删除运营商品' } }),
  );
  await page.route('**/api/admin/slabs', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 99601,
            name: '协同大板',
            serialNo: 'SLAB-COLLAB',
            status: 'selling',
            sourceStatus: 'offShelf',
            sourceUnavailable: true,
            sourceMessage: sourceBlockMessage('offShelf'),
          },
        ],
      },
    }),
  );
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByRole('main').locator('.source-unavailable-overlay')).toContainText('该商品已被供应链下架');
  await expect(page.locator('.selection-info')).toContainText('已选 0 项');
});

test('操作时来源不可用直接刷新遮罩，不显示 toast 或确认弹框', async ({ page }) => {
  await setup(page, 'selling');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions.push('admin.slab-management.selling.off-shelf');
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  let submissions = 0;
  await page.route('**/api/admin/slabs/batch-status', (route) => {
    submissions++;
    return route.fulfill({ json: { code: 0, data: true } });
  });
  await page.route('**/api/admin/slabs/action-check', (route) =>
    route.fulfill({ status: 400, json: { code: 400, message: '来源商品未上架或已删除，只能彻底删除运营商品' } }),
  );
  await page.reload();
  await page.getByRole('main').locator('tbody tr').first().locator('.t-checkbox').click();
  await page.route('**/api/admin/slabs', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: [
          {
            id: 99601,
            name: '协同大板',
            serialNo: 'SLAB-COLLAB',
            status: 'selling',
            sourceStatus: 'offShelf',
            sourceUnavailable: true,
            sourceMessage: sourceBlockMessage('offShelf'),
          },
        ],
      },
    }),
  );
  await page.getByRole('main').locator('.table-actions').getByText('下架', { exact: true }).click();
  await expect(page.getByRole('main').locator('.source-unavailable-overlay')).toContainText('该商品已被供应链下架');
  await expect(page.locator('.selection-info')).toContainText('已选 0 项');
  await expect(page.locator('.t-message')).toHaveCount(0);
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  expect(submissions).toBe(0);
});

test('批量下架初次打开和重新打开不显示校验错误，提交时仍校验', async ({ page }) => {
  await setup(page, 'selling');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions.push('admin.slab-management.selling.batch-off-shelf');
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  await page.reload();
  await page.getByRole('main').locator('tbody tr').first().locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量下架', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.t-form__controls-message')).toHaveCount(0);
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog.getByText('请选择下架原因', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '批量下架', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.t-form__controls-message')).toHaveCount(0);
});

for (const [status, actions] of Object.entries({
  warehouse: [
    ['详情', 'detail'],
    ['价格', 'price'],
    ['上架', 'shelf'],
    ['删除', 'delete'],
  ],
  selling: [
    ['详情', 'detail'],
    ['价格', 'price'],
    ['下架', 'off-shelf'],
  ],
  offShelf: [
    ['详情', 'detail'],
    ['放回仓库', 'restore'],
    ['删除', 'delete'],
  ],
  recycle: [
    ['详情', 'detail'],
    ['价格', 'price'],
    ['放回仓库', 'restore'],
    ['彻底删除', 'purge'],
  ],
})) {
  for (const [label, permission] of actions) {
    test(`${status} 点击${label}时来源失效直接显示遮罩`, async ({ page }) => {
      await setup(page, status);
      await page.addInitScript(
        (permission) => {
          const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
          user.permissions.push(permission);
          localStorage.setItem('zdm-admin-user', JSON.stringify(user));
        },
        `${prefix}${scope(status)}.${permission}`,
      );
      await page.reload();
      await expect(page.getByRole('main').locator('.table-actions').getByText(label, { exact: true })).toBeVisible();
      await page.route('**/api/admin/slabs', (route) =>
        route.fulfill({
          json: {
            code: 0,
            data: [
              {
                id: 99601,
                name: '协同大板',
                serialNo: 'SLAB-COLLAB',
                status,
                sourceStatus: 'offShelf',
                sourceUnavailable: true,
                sourceMessage: sourceBlockMessage('offShelf'),
              },
            ],
          },
        }),
      );
      await page.getByRole('main').locator('.table-actions').getByText(label, { exact: true }).click();
      await expect(page.getByRole('main').locator('.source-unavailable-overlay')).toContainText('该商品已被供应链下架');
      await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
      await expect(page.locator('.t-drawer--open')).toHaveCount(0);
      await expect(page.locator('.t-message')).toHaveCount(0);
    });
  }
}

test('批量上架部分成功，失败横幅可关闭并在页面刷新后清空', async ({ page }) => {
  await setup(page, 'warehouse');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions.push('admin.slab-management.warehouse.batch-shelf');
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  const records = [99601, 99602, 99603].map((id) => ({
    id,
    name: `大板${id}`,
    serialNo: String(id),
    status: 'warehouse',
    sourceStatus: 'selling',
    sourceUnavailable: false,
    sourceMessage: null as string | null,
  }));
  await page.route('**/api/admin/slabs', (route) => route.fulfill({ json: { code: 0, data: records } }));
  const requests: number[] = [];
  await page.route('**/api/admin/slabs/batch-status', (route) => {
    const id = route.request().postDataJSON().ids[0];
    requests.push(id);
    if (id === 99601) {
      records[0].status = 'selling';
      return route.fulfill({ json: { code: 0, data: true } });
    }
    if (id === 99603) {
      records[2].sourceStatus = 'offShelf';
      records[2].sourceUnavailable = true;
      records[2].sourceMessage = sourceBlockMessage('offShelf');
    }
    return route.fulfill({
      status: 400,
      json: { code: 400, message: id === 99602 ? '4级合伙人价格未填写' : '来源商品已下架' },
    });
  });
  await page.reload();
  await page.getByRole('main').locator('thead .t-checkbox').first().click();
  await page.getByRole('button', { name: '批量上架', exact: true }).click();
  await page.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(page.getByText('已上架 1 个大板，未上架 2 个大板', { exact: true })).toBeVisible();
  const warning = page.getByRole('main').locator('.t-alert');
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText('4级合伙人价格未填写');
  await expect(page.getByRole('main').locator('tbody tr')).toHaveCount(2);
  const failedRow = page.getByRole('main').locator('tr[data-shelf-error-id="99602"]');
  const rowBounds = await failedRow.boundingBox();
  const bannerBounds = await warning.boundingBox();
  const actionBounds = await failedRow.locator('.t-table__cell--fixed-right').boundingBox();
  expect(bannerBounds!.y).toBeGreaterThan(rowBounds!.y);
  expect(bannerBounds!.y + bannerBounds!.height).toBeLessThan(rowBounds!.y + rowBounds!.height);
  expect(bannerBounds!.x + bannerBounds!.width).toBeGreaterThan(actionBounds!.x);
  expect(bannerBounds!.x + bannerBounds!.width).toBeLessThanOrEqual(actionBounds!.x + actionBounds!.width);
  const actions = await failedRow.locator('.table-actions').boundingBox();
  expect(bannerBounds!.y + bannerBounds!.height).toBeLessThan(actions!.y);
  expect(bannerBounds!.height).toBeLessThanOrEqual(28);
  await expect(page.getByRole('main').locator('.source-unavailable-overlay')).toHaveCount(1);
  await expect(page.locator('.selection-info')).toContainText('已选 1 项');
  expect([...requests].sort()).toEqual([99601, 99602, 99603]);
  await warning.locator('.t-alert__close').click();
  await expect(warning).toHaveCount(0);
  await page.getByRole('button', { name: '批量上架', exact: true }).click();
  await page.getByRole('button', { name: '确认批量上架', exact: true }).click();
  await expect(warning).toContainText('4级合伙人价格未填写');
  await page.reload();
  await expect(page.getByRole('main').getByText('大板99602', { exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('彻底删除操作日志显示删除终态，与成品现货一致', async ({ page }) => {
  await setup(page, 'warehouse');
  await page.addInitScript(() => {
    const user = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    user.permissions.push('admin.slab-management.operation-log.view');
    localStorage.setItem('zdm-admin-user', JSON.stringify(user));
  });
  await page.route('**/api/admin/slabs/operation-logs?**', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          records: [
            {
              id: 991,
              slabId: 99601,
              slabName: '已删除大板',
              slabSerialNo: 'SLAB-COLLAB',
              operationType: 'PURGE',
              operationSummary: '彻底删除大板',
              beforeStatus: 'warehouse',
              afterStatus: 'purged',
              operationSource: 'MANUAL',
              operatorName: '大板验收',
              operatedAt: '2026-09-22T09:46:00',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      },
    }),
  );
  await page.reload();
  await page.getByRole('main').getByText('操作日志', { exact: true }).click();
  const logRow = page.locator('.t-drawer--open tbody tr').filter({ hasText: '已删除大板' });
  await logRow.getByText('详情', { exact: true }).click();
  await expect(page.locator('.t-dialog:visible')).toContainText('仓库中 → 已彻底删除');
});
