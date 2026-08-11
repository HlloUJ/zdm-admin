import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
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

async function expectUnifiedConfirmDialog(page: Page, options: { action: string; content: string; danger?: boolean }) {
  const dialog = page.locator('.zdm-admin-confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`确认${options.action}`);
  await expect(dialog).toContainText(options.content);

  const confirmButton = dialog.getByRole('button', { name: `确认${options.action}`, exact: true });
  await expect(confirmButton).toBeVisible();
  if (options.danger) await expect(confirmButton).toHaveClass(/t-button--theme-danger/);
  await expect(dialog).toHaveCSS('width', '440px');
}

test('uses the same action-specific confirmation foundation across modules', async ({ page }) => {
  await page.goto('/product-attribute');
  const attributeRow = page.locator('tbody tr').filter({ hasText: 'E2E 共享属性' });
  await attributeRow.getByText('删除', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '删除',
    content: '是否删除属性“E2E 共享属性”？',
    danger: true,
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.goto('/supplier-management');
  const supplierRow = page.locator('tbody tr').filter({ hasText: '装点猫大板供应商' });
  await supplierRow.getByText('停用', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '停用',
    content: '是否停用供应商“装点猫大板供应商”？',
  });
  await page.getByRole('button', { name: '取消', exact: true }).click();

  await page.goto('/slab-management');
  const slabRow = page.getByRole('row', { name: /雪花白大板 06/ });
  await slabRow.getByText('删除', { exact: true }).click();
  await expectUnifiedConfirmDialog(page, {
    action: '删除',
    content: '是否删除大板“雪花白大板 06”？',
    danger: true,
  });
});

test('shows the same object-specific success copy for category, store category, and employee status changes', async ({
  page,
}) => {
  await page.goto('/supplier-management');
  const supplierRow = page.getByRole('row', { name: /装点猫大板供应商/ });
  await supplierRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“装点猫大板供应商”', { exact: true })).toBeVisible();
  await supplierRow.getByText('启用', { exact: true }).click();
  await page.getByRole('button', { name: '确认启用', exact: true }).click();
  await expect(page.getByText('已启用“装点猫大板供应商”', { exact: true })).toBeVisible();

  await page.goto('/product-category');
  const productCategoryRow = page.getByRole('row', { name: /成品现货 一级分类/ });
  await productCategoryRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  const productCategoryFeedback = page.getByText('已停用“成品现货”', { exact: true });
  await expect(productCategoryFeedback).toBeVisible();
  const feedbackBox = await productCategoryFeedback.locator('..').boundingBox();
  expect(feedbackBox?.width).toBeLessThan(320);

  await page.goto('/store-category-management');
  await page
    .getByRole('row', { name: /石材 1级分类/ })
    .getByRole('button', { name: '展开下级分类' })
    .click();
  const storeCategoryRow = page.getByRole('row', { name: /大理石 2级分类/ });
  await storeCategoryRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“大理石”', { exact: true })).toBeVisible();

  await page.goto('/employee-management');
  const employeeRow = page.getByRole('row', { name: /测试员工/ });
  await employeeRow.getByText('停用', { exact: true }).click();
  await page.getByRole('button', { name: '确认停用', exact: true }).click();
  await expect(page.getByText('已停用“测试员工”', { exact: true })).toBeVisible();
});

test('shows object-specific success copy in craft, slab variety, attribute, and attribute value modules', async ({
  page,
}) => {
  const cases = [
    { path: '/finished-stock-craft', target: 'E2E 边工艺' },
    { path: '/slab-variety', target: '潘多拉' },
    { path: '/product-attribute', target: 'E2E 共享属性' },
    { path: '/product-attribute-value', target: 'E2E 共享属性值' },
  ];

  for (const item of cases) {
    await page.goto(item.path);
    const row = page.locator('tbody tr').filter({ hasText: item.target });
    await row.getByText('停用', { exact: true }).click();
    await page.getByRole('button', { name: '确认停用', exact: true }).click();
    await expect(page.getByText(`已停用“${item.target}”`, { exact: true })).toBeVisible();
  }
});

test('shows 已新增加名称 after creating an item', async ({ page }) => {
  await page.goto('/product-attribute');
  await page.getByRole('main').getByRole('button', { name: '新增', exact: true }).click();

  await page.getByPlaceholder('请输入属性名称').fill('E2E 新增属性');
  await page.getByText('文本输入', { exact: true }).click();
  await page.getByRole('button', { name: '提交', exact: true }).click();

  await expect(page.getByText('已新增“E2E 新增属性”', { exact: true })).toBeVisible();
});

const deletionCases = [
  { path: '/supplier-management', target: '装点猫大板供应商' },
  { path: '/tenant-management', target: '装点猫直营租户' },
  { path: '/tenant-store-management', target: '杭州体验门店' },
  { path: '/role-management', target: '运营管理平台角色' },
  { path: '/employee-management', target: '测试员工' },
  { path: '/finished-stock-craft', target: 'E2E 边工艺' },
  { path: '/slab-variety', target: '潘多拉' },
  { path: '/product-attribute', target: 'E2E 共享属性', targetPattern: /E2E (?:全局)?共享属性/ },
  { path: '/product-attribute-value', target: 'E2E 共享属性值', targetPattern: /E2E (?:全局)?共享属性值/ },
];

for (const item of deletionCases) {
  test(`shows 已删除加名称 after deleting ${item.target}`, async ({ page }) => {
    await page.goto(item.path);
    const row = page.locator('tbody tr').filter({ hasText: item.targetPattern ?? item.target });
    const targetName = item.targetPattern ? await row.locator('td').first().innerText() : item.target;
    await row.getByText('删除', { exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByText(`已删除“${targetName}”`, { exact: true })).toBeVisible();
  });
}
