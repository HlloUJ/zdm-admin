import { test, expect, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
async function setup(page: Page, audience = 'store', permissions = ['all']) {
  await installAdminApiMocks(page);
  await page.addInitScript(
    ({ audience, permissions }) => {
      localStorage.setItem('zdm-admin-token', 'prototype-test-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 7,
          identityId: 7,
          name: '原型导购',
          phone: '13800000000',
          clientCode: audience === 'supply-chain' ? 'supply-chain' : 'admin',
          roles: [],
          permissions,
          dataPermission: 'all',
          tenantId: audience === 'admin' ? undefined : 1,
          storeId: audience === 'admin' || audience === 'supply-chain' ? undefined : 2,
          storeType: audience === 'supplier' ? 'slabSupplier' : 'cityPartner',
          storeName: '原型门店',
        }),
      );
    },
    { audience, permissions },
  );
}
test('store order prototype has five status views and drill-down without business writes', async ({ page }) => {
  await setup(page);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/store/order-management/sales');
  await expect(page.getByText('订单管理', { exact: true })).toBeVisible();
  for (const label of ['待确认', '已确认', '已发货', '已完成', '已取消'])
    await expect(page.locator('.t-tabs__nav-item').filter({ hasText: new RegExp(`^${label}（1）$`) })).toBeVisible();
  await expect(page.getByText(/^XS\d{13}$/)).toBeVisible();
  const sampleNumber = await page.getByText(/^XS\d{13}$/).innerText();
  await page.reload();
  await expect(page.getByText(sampleNumber, { exact: true })).toBeVisible();
  await page
    .locator('.t-tabs__nav-item')
    .filter({ hasText: /^已发货（\d+）$/ })
    .click();
  await expect(page.getByText('部分发货', { exact: true }).last()).toBeVisible();
  const number = page.getByText(/^XS\d{13}$/);
  await expect(number).not.toHaveAttribute('role');
  await expect(number).not.toHaveAttribute('tabindex');
  await expect(number.locator('..')).toHaveCSS('color', 'rgb(91, 117, 166)');
  await expect(number.locator('xpath=ancestor::header')).toHaveCSS('border-left-color', 'rgb(91, 117, 166)');
  await expect(number.locator('..')).toHaveCSS('font-weight', '600');
  await number.click();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '详情', exact: true }).click();
  await expect(page.getByText('金额计算过程', { exact: true })).toBeVisible();
  await expect(page.getByText('操作记录', { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
test('creates a local pending order using the real form and persists its snapshot', async ({ page }) => {
  await setup(page);
  await page.goto('/store/order-management/sales');
  await page.getByRole('button', { name: '新增订单', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增订单' });
  await dialog.getByPlaceholder('请输入联系电话', { exact: true }).fill('13800000088');
  await dialog.getByPlaceholder('请输入客户姓名', { exact: true }).fill('原型客户');
  await dialog.getByPlaceholder('请选择商品', { exact: true }).click();
  await page
    .getByText(/云雾白大理石餐桌 · CT-001 · 可售/)
    .last()
    .click();
  await dialog.getByRole('button', { name: '添加商品', exact: true }).click();
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('原型客户', { exact: true }).first()).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('zdm-order-prototype-v1:1:2:7:7') || 'null'),
  );
  expect(stored.orders[0].status).toBe('pending');
  expect(stored.orders[0].id).toMatch(/^XS\d{13}$/);
  expect(stored.orders[0].lines[0].sku).toBe('CT-001');
  expect(stored.orders[0].lines[0].reserved).toBe(0);
});
test('single granted status hides tabs and all ungranted mutations', async ({ page }) => {
  await setup(page, 'store', ['store.order-management.sales.completed.view']);
  await page.goto('/store/order-management/sales');
  await expect(page.getByText(/^XS\d{13}$/)).toBeVisible();
  await expect(page.locator('.t-tabs__nav-item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增订单', exact: true })).toHaveCount(0);
  await expect(page.getByText('确认订单', { exact: true })).toHaveCount(0);
});
for (const audience of ['admin', 'supplier', 'supply-chain'])
  test(`${audience} cannot enter the store order prototype`, async ({ page }) => {
    await setup(page, audience);
    await page.goto('/store/order-management/sales');
    await expect(page).not.toHaveURL(/order-management/);
    await expect(page.getByText('订单管理', { exact: true })).toHaveCount(0);
  });

test('payment configuration starts empty and supports CRUD without rewriting historical receipts', async ({ page }) => {
  await setup(page);
  await page.goto('/store/order-management/settings');
  await page.getByText('订单管理', { exact: true }).click();
  await expect(page.getByText('款项配置', { exact: true })).toBeVisible();
  await expect(page.getByText('订单管理前端原型', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '首付款', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增', exact: true }).click();
  let dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增款项名称' });
  await dialog.getByPlaceholder('请输入名称', { exact: true }).fill('全款');
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(page.getByText('已新增“全款”', { exact: true })).toBeVisible();
  let row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '全款', exact: true }) });
  await expect(row.getByText('原型导购', { exact: true })).toBeVisible();
  await expect(row).toContainText(/20\d{2}/);
  await row.getByText('编辑', { exact: true }).click();
  dialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑款项名称' });
  await expect(dialog.getByPlaceholder('请输入名称', { exact: true })).toHaveValue('全款');
  await dialog.getByPlaceholder('请输入名称', { exact: true }).fill('成交款');
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.getByText('修改成功', { exact: true })).toBeVisible();
  row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '成交款', exact: true }) });
  await row.getByText('停用', { exact: true }).click();
  await expect(row.locator('.t-tag')).toHaveText('启用');
  await page.locator('.t-dialog:visible').getByRole('button', { name: '取消', exact: true }).click();
  await expect(row.locator('.t-tag')).toHaveText('启用');
  await row.getByText('停用', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“成交款”', { exact: true })).toBeVisible();
  await expect(row.getByText('停用', { exact: true })).toBeVisible();
  await row.getByText('启用', { exact: true }).click();
  await expect(row.locator('.t-tag')).toHaveText('停用');
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认启用', exact: true }).click();
  await expect(page.getByText('已启用“成交款”', { exact: true })).toBeVisible();
  await row.getByText('删除', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText('已删除“成交款”', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zdm-order-prototype-v1:1:2:7:7') || 'null'));
  expect(saved.settings).toEqual([]);
  expect(saved.orders.find((o: { status: string }) => o.status === 'completed').payments[0].nature).toBe('全款');
  await expect(page.locator('.t-tabs__nav-item')).toHaveCount(0);
  await expect(page.getByText('收退款渠道', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增款项名称' });
  await dialog.getByPlaceholder('请输入名称', { exact: true }).fill('预付款');
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await page.evaluate(() => {
    const key = 'zdm-order-prototype-v1:1:2:7:7';
    const state = JSON.parse(localStorage.getItem(key) || 'null');
    state.settings.push({ id: 'nature-0', group: 'nature', name: '首付款', enabled: true });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole('cell', { name: '首付款', exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '预付款', exact: true })).toBeVisible();
  await page.goto('/store/order-management/sales');
  await page.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByRole('button', { name: '登记收款', exact: true }).click();
  dialog = page.locator('.t-dialog:visible');
  await dialog.getByPlaceholder('请选择收退款渠道', { exact: true }).click();
  for (const name of ['现金', '银行转账', '微信', '支付宝'])
    await expect(page.locator('.t-select-option').getByText(name, { exact: true })).toBeVisible();
});

test('partitioned order cards retain summaries and independently toggle product details', async ({ page }) => {
  await setup(page);
  await page.goto('/store/order-management/sales');
  const firstId = await page.getByText(/^XS\d{13}$/).innerText();
  const secondId = 'XS1234567890123';
  await page.evaluate((secondId) => {
    const key = 'zdm-order-prototype-v1:1:2:7:7';
    const state = JSON.parse(localStorage.getItem(key)!);
    const second = structuredClone(state.orders.find((order: { status: string }) => order.status === 'pending'));
    second.id = secondId;
    state.orders.push(second);
    localStorage.setItem(key, JSON.stringify(state));
  }, secondId);
  await page.reload();
  const cards = page.locator('.order-card');
  await expect(cards).toHaveCount(2);
  const first = page.locator(`[data-order-id="${firstId}"]`),
    second = page.locator(`[data-order-id="${secondId}"]`);
  for (const label of ['客户', '负责人', '创建人', '创建时间', '成交金额', '收款情况', '发货进度', '异常'])
    await expect(first.locator('.business-intro, .metric-band').getByText(label, { exact: true })).toBeVisible();
  await expect(page.locator('.order-goods')).toHaveCount(0);
  await expect(first.locator('.meta-phone')).toHaveText('138****0001');
  await expect(page.locator('.sales-order-toolbar')).not.toContainText('笔订单');
  await first.locator('.order-toggle').click();
  await expect(first.locator('.order-goods')).toBeVisible();
  await expect(second.locator('.order-goods')).toHaveCount(0);
  await expect(first.getByRole('columnheader')).toHaveText([
    '商品信息',
    '规格',
    '单价',
    '购买数量',
    '金额',
    '发货进度',
  ]);
  await expect(first.getByRole('img', { name: '云雾白大理石餐桌', exact: true })).toBeVisible();
  await expect(first.locator('.order-product__text')).toContainText('CT-001');
  const imageTrigger = first.getByRole('button', { name: '查看云雾白大理石餐桌大图', exact: true });
  const imageDialog = page.locator('.t-dialog:visible');
  await imageTrigger.click();
  await expect(imageDialog.getByRole('img', { name: '云雾白大理石餐桌', exact: true })).toBeVisible();
  await imageDialog.getByRole('img', { name: '云雾白大理石餐桌', exact: true }).click();
  await expect(imageDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(imageDialog).toHaveCount(0);
  await imageTrigger.click();
  await imageDialog.locator('.t-dialog__close').click();
  await expect(imageDialog).toHaveCount(0);
  await imageTrigger.click();
  await page.mouse.click(5, 5);
  await expect(imageDialog).toHaveCount(0);
  await expect(first.locator('.order-goods')).toBeVisible();

  await first.locator('.order-toggle').click();
  await expect(first.locator('.order-goods')).toHaveCount(0);
  await expect(first.getByText('成交金额', { exact: true })).toBeVisible();
  await second.locator('.order-toggle').click();
  await first.locator('.order-toggle').click();
  await expect(page.locator('.order-goods')).toHaveCount(2);
  await first.locator('.order-toggle').press('Enter');
  await expect(page.locator('.order-goods')).toHaveCount(1);
  await page
    .locator('.t-tabs__nav-item')
    .filter({ hasText: /^已发货（\d+）$/ })
    .click();
  await expect(page.locator('.order-goods')).toHaveCount(0);
  await page.locator('.order-toggle').click();
  await expect(page.locator('.order-goods').getByText('已发 2 / 待发 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '安排发货', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '安排发货', exact: true }).click();
  await expect(page.locator('.t-dialog:visible')).toBeVisible();
});

test('status totals respect order scope, creation dates filter pending orders, and action names are not clipped', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-21T02:00:00Z'));
  await setup(page);
  await page.goto('/store/order-management/sales');
  await expect(page.locator('.order-card')).toHaveCount(1);
  await page.evaluate(() => {
    const key = 'zdm-order-prototype-v1:1:2:7:7';
    const state = JSON.parse(localStorage.getItem(key)!);
    const pending = state.orders.find((order: { status: string }) => order.status === 'pending');
    pending.createdAt = '2026-10-11T02:00:00Z';
    pending.customerName = '十一日创建客户';
    pending.confirmedAt = '';
    const other = structuredClone(pending);
    other.id = 'XS1234567890123';
    other.createdAt = '2026-10-10T02:00:00Z';
    other.customerName = '十日创建客户';
    state.orders.push(other);
    const foreign = structuredClone(other);
    foreign.id = 'XS1234567890456';
    foreign.storeId = 999;
    state.orders.push(foreign);
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('.t-tabs__nav-item').filter({ hasText: /^待确认（2）$/ })).toBeVisible();
  for (const label of ['已确认', '已发货', '已完成', '已取消'])
    await expect(page.locator('.t-tabs__nav-item').filter({ hasText: new RegExp(`^${label}（1）$`) })).toBeVisible();
  await expect(page.getByText('创建时间', { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder('开始日期', { exact: true }).click();
  const date = page.locator('.t-date-picker__cell:visible').filter({ hasText: /^10$/ }).first();
  await date.click();
  await date.click();
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('十日创建客户', { exact: false })).toBeVisible();
  await expect(page.getByText('十一日创建客户', { exact: false })).toHaveCount(0);
  await expect(page.locator('.t-tabs__nav-item').filter({ hasText: /^待确认（2）$/ })).toBeVisible();
  await page.getByRole('button', { name: '操作', exact: true }).click();
  const menu = page.locator('.t-dropdown__menu:visible');
  await expect(menu.getByText('调整运费、交期或负责人', { exact: true })).toBeVisible();
  const clipped = await menu
    .locator('.t-dropdown__item-text')
    .evaluateAll((elements) => elements.some((el) => el.scrollWidth > el.clientWidth));
  expect(clipped).toBe(false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(page.locator('.order-card')).toHaveCount(2);
});

test('status tabs keep native scale and alignment while order amounts follow collapsed and expanded typography', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/store/order-management/sales');
  const tabs = page.locator('.sales-order-filter-card .t-tabs__nav-item');
  await expect(tabs).toHaveCount(5);
  const amount = page.locator('.order-metric__amount').first();
  // The accepted compact card uses mark-medium; expanding restores title-large.
  await expect(amount).toHaveCSS('font-size', '14px');
  await expect(amount).toHaveCSS('font-weight', '600');
  await expect(amount).toHaveCSS('line-height', '22px');
  await page.locator('.order-toggle').first().click();
  await expect(amount).toHaveCSS('font-size', '18px');
  await expect(amount).toHaveCSS('line-height', '26px');
  await page.locator('.order-toggle').first().click();
  await expect(amount).toHaveCSS('font-size', '14px');
  for (let index = 0; index < 5; index++) {
    const tab = tabs.nth(index);
    await tab.click();
    await expect(tab).toHaveCSS('font-size', '14px');
    await expect(tab).toHaveClass(/t-is-active/);
    await expect
      .poll(async () => {
        const item = await tab.boundingBox();
        const indicator = await page.locator('.sales-order-filter-card .t-tabs__bar').boundingBox();
        if (!item || !indicator) return Infinity;
        return Math.abs(item.x + item.width / 2 - indicator.x - indicator.width / 2);
      })
      .toBeLessThan(1);
  }
});

test('unchanged pagination events preserve expanded goods while real page changes still work', async ({ page }) => {
  await setup(page);
  await page.goto('/store/order-management/sales');
  await page.locator('.order-toggle').click();
  const previous = page.locator('.sales-order-list > .zdm-admin-pagination .t-pagination__btn-prev');
  const next = page.locator('.sales-order-list > .zdm-admin-pagination .t-pagination__btn-next');
  await expect(previous).toHaveClass(/t-is-disabled/);
  await expect(next).toHaveClass(/t-is-disabled/);
  await previous.click();
  await expect(page.locator('.order-goods')).toBeVisible();
  await next.click();
  await expect(page.locator('.order-goods')).toBeVisible();
  await page.locator('.sales-order-list > .zdm-admin-pagination .t-pagination__number').click();
  await expect(page.locator('.order-goods')).toBeVisible();

  await page.evaluate(() => {
    const key = 'zdm-order-prototype-v1:1:2:7:7';
    const state = JSON.parse(localStorage.getItem(key)!);
    const order = state.orders.find((item: { status: string }) => item.status === 'pending');
    for (let index = 0; index < 10; index++) {
      const copy = structuredClone(order);
      copy.id = 'XS' + String(index + 1).padStart(13, '0');
      state.orders.push(copy);
    }
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('.order-card')).toHaveCount(10);
  await page.locator('.order-toggle').first().click();
  await expect(page.locator('.order-goods')).toBeVisible();
  await expect(next).not.toHaveClass(/t-is-disabled/);
  await next.click();
  await expect(page.locator('.order-card')).toHaveCount(1);
  await expect(page.locator('.order-goods')).toHaveCount(0);
  await previous.click();
  await expect(page.locator('.order-card')).toHaveCount(10);
});
