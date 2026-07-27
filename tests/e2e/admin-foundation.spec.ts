import { expect, type Page, type Route, test } from '@playwright/test';

const apiOk = (data: unknown) => ({
  code: 0,
  message: 'ok',
  data,
});

const fulfillJson = (route: Route, data: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(apiOk(data)),
  });

const tenants = [
  {
    id: 1,
    name: '装点猫直营租户',
    contactName: '超级管理员',
    contactPhone: '15926626945',
    status: 'enabled',
    businessTypes: 'cityPartner,slabSupplier,finishedSupplier,factory',
    remark: '系统内置平台租户',
    createdAt: '2026-07-27T09:00:00',
  },
];

const stores = [
  {
    id: 1,
    tenantId: 1,
    name: '杭州体验门店',
    type: 'cityPartner',
    shopLevel: 'level1',
    manager: '超级管理员',
    region: 'zhejiang/hangzhou/xihu',
    detailAddress: '样例地址 1 号',
    address: '浙江省杭州市西湖区样例地址 1 号',
    status: 'enabled',
    remark: '系统内置门店',
    createdAt: '2026-07-27T09:00:00',
  },
];

const suppliers = [
  {
    id: 1,
    name: '装点猫大板供应商',
    type: 'slab',
    contactName: '供应商联系人',
    contactPhone: '15926626946',
    qualificationStatus: 'approved',
    status: 'enabled',
    remark: '系统内置供应商',
    createdAt: '2026-07-27T09:00:00',
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await mockFoundationApis(page);
});

test('opens tenant create, business and edit dialogs', async ({ page }) => {
  await page.goto('/tenant-management');
  const main = page.getByRole('main');

  await expect(main.getByText('租户管理').first()).toBeVisible();
  await expect(main.getByText('装点猫直营租户')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('租户姓名')).toBeVisible();
  await expect(createDialog.getByText('联系方式')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const tenantRow = page.locator('tbody tr').filter({ hasText: '装点猫直营租户' }).first();
  await tenantRow.getByText('业务开通').click();
  const businessDialog = page.locator('.t-dialog').filter({ hasText: '业务开通' });
  await expect(businessDialog).toBeVisible();
  await expect(businessDialog.getByText('城市合伙人')).toBeVisible();
  await expect(businessDialog.getByText('大板供应商')).toBeVisible();
  await businessDialog.getByRole('button', { name: '取消' }).click();
  await expect(businessDialog).toBeHidden();

  await tenantRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫直营租户');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('opens store create, level and edit dialogs', async ({ page }) => {
  await page.goto('/tenant-store-management');
  const main = page.getByRole('main');

  await expect(main.getByText('门店管理').first()).toBeVisible();
  await expect(main.getByText('杭州体验门店')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('选择租户')).toBeVisible();
  await expect(createDialog.getByText('店铺类型')).toBeVisible();
  await expect(createDialog.getByText('门店地址')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const storeRow = page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first();
  await storeRow.locator('.level-cell').hover();
  await storeRow.getByLabel('快速编辑店铺级别').click();
  const levelDialog = page.locator('.t-dialog').filter({ hasText: '店铺级别' });
  await expect(levelDialog).toBeVisible();
  await expect(levelDialog.getByText('店铺级别').first()).toBeVisible();
  await levelDialog.getByRole('button', { name: '取消' }).click();
  await expect(levelDialog).toBeHidden();

  await storeRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('杭州体验门店');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

test('opens supplier create and edit dialogs', async ({ page }) => {
  await page.goto('/supplier-management');
  const main = page.getByRole('main');

  await expect(main.getByText('供应商管理').first()).toBeVisible();
  await expect(main.getByText('装点猫大板供应商')).toBeVisible();

  await main.getByRole('button', { name: /新增/ }).click();
  const createDialog = page.locator('.t-dialog').filter({ hasText: '新增' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByText('供应商名称')).toBeVisible();
  await expect(createDialog.getByText('供应商类型')).toBeVisible();
  await expect(createDialog.getByText('联系电话')).toBeVisible();
  await createDialog.getByRole('button', { name: '取消' }).click();
  await expect(createDialog).toBeHidden();

  const supplierRow = page.locator('tbody tr').filter({ hasText: '装点猫大板供应商' }).first();
  await supplierRow.getByText('编辑').click();
  const editDialog = page.locator('.t-dialog').filter({ hasText: '编辑' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.locator('input').first()).toHaveValue('装点猫大板供应商');
  await editDialog.getByRole('button', { name: '取消' }).click();
  await expect(editDialog).toBeHidden();
});

async function mockFoundationApis(page: Page) {
  await page.route('**/api/admin/tenants', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, tenants);
      return;
    }
    await fulfillJson(route, tenants[0]);
  });

  await page.route('**/api/admin/stores', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, stores);
      return;
    }
    await fulfillJson(route, stores[0]);
  });

  await page.route('**/api/admin/suppliers', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, suppliers);
      return;
    }
    await fulfillJson(route, suppliers[0]);
  });
}
