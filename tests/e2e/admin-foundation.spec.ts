import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
  });
  await installAdminApiMocks(page);
});

test('keeps foundation pagination spacing consistent inside list layouts', async ({ page }) => {
  await page.goto('/category-attribute-template');

  const styles = await page.locator('.zdm-admin-list-layout__pagination').evaluate((host) => {
    const pagination = host.querySelector<HTMLElement>('.zdm-admin-pagination');
    if (!pagination) return null;

    const hostStyle = getComputedStyle(host);
    const paginationStyle = getComputedStyle(pagination);
    return {
      hostMarginTop: hostStyle.marginTop,
      paginationDisplay: paginationStyle.display,
      paginationJustifyContent: paginationStyle.justifyContent,
      paginationMarginTop: paginationStyle.marginTop,
      paginationWidth: paginationStyle.width,
      hostWidth: getComputedStyle(host).width,
    };
  });

  expect(styles).toEqual({
    hostMarginTop: '16px',
    paginationDisplay: 'flex',
    paginationJustifyContent: 'flex-end',
    paginationMarginTop: '0px',
    paginationWidth: styles?.hostWidth,
    hostWidth: styles?.hostWidth,
  });
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
  const tableHeaders = main.locator('thead th');
  await expect(tableHeaders.nth(8)).toContainText('创建人');
  await expect(tableHeaders.nth(9)).toContainText('创建时间');
  await expect(page.locator('tbody tr').filter({ hasText: '杭州体验门店' }).first()).toContainText('韩健');

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
