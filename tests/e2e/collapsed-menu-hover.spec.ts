import { productWarehouseUrl } from './product-test-navigation';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';

async function crossPopupGap(page: Page, trigger: Locator, panel: Locator) {
  await trigger.hover();
  await expect(panel).toBeVisible();
  const origin = (await trigger.boundingBox())!;
  const popup = (await panel.boundingBox())!;
  const y = origin.y + origin.height / 2;
  // Pause in the actual gap longer than TDesign's native 100ms hide timer.
  expect(popup.x).toBeGreaterThan(origin.x + origin.width);
  await page.mouse.move((origin.x + origin.width + popup.x) / 2, y);
  await page.waitForTimeout(200);
  await expect(panel).toBeVisible();
  await page.mouse.move(popup.x + popup.width / 2, y);
  await page.waitForTimeout(200);
  await expect(panel).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 939, height: 858 });
  await installAdminApiMocks(page);
  await page.addInitScript(() => {
    localStorage.setItem('zdm-admin-token', 'dev-token');
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'admin',
        name: '测试管理员',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto(productWarehouseUrl('/dashboard'));
  await expect(page.locator('.side-nav > .t-default-menu')).toHaveClass(/t-is-collapsed/);
});

test('collapsed second and third level menus stay open across gaps and close after leaving the menu chain', async ({
  page,
}) => {
  const trigger = page.locator('.side-nav .menu-level-one').filter({ hasText: '商品管理' });
  const second = page
    .locator('.t-popup:not(.t-menu-is-nested) > .t-menu__popup:visible')
    .filter({ hasText: '商品公共基础数据' });
  await crossPopupGap(page, trigger, second);
  const nested = second.locator('.menu-level-two').filter({ hasText: '商品公共基础数据' });
  const third = page.locator('.t-popup.t-menu-is-nested > .t-menu__popup:visible').filter({ hasText: '属性库管理' });
  await crossPopupGap(page, nested, third);
  await expect(second).toBeVisible();
  await third.getByText('商品分类管理', { exact: true }).hover();
  await page.waitForTimeout(200);
  await expect(second).toBeVisible();
  await expect(third).toBeVisible();
  const parentBox = (await second.boundingBox())!;
  await page.mouse.move(parentBox.x + parentBox.width - 2, parentBox.y + parentBox.height - 2, { steps: 12 });
  await page.waitForTimeout(200);
  await expect(second).toBeVisible();
  await page.mouse.move(700, 700);
  await expect(second).toHaveCount(0);
  await expect(third).toHaveCount(0);
});

test('collapsed popup items still navigate to the original business routes', async ({ page }) => {
  await page.locator('.side-nav .menu-level-one').filter({ hasText: '商品管理' }).hover();
  const second = page
    .locator('.t-popup:not(.t-menu-is-nested) > .t-menu__popup:visible')
    .filter({ hasText: '商品公共基础数据' });
  await second.locator('.menu-level-two').filter({ hasText: '商品公共基础数据' }).hover();
  const third = page.locator('.t-popup.t-menu-is-nested > .t-menu__popup:visible').filter({ hasText: '属性库管理' });
  await third.getByText('商品分类管理', { exact: true }).click();
  await expect(page).toHaveURL(/\/product-category$/);
  await expect(page.locator('.t-menu__popup:visible')).toHaveCount(0);
});

test('a slow diagonal move from the icon into the last menu item retains the panel', async ({ page }) => {
  const trigger = page.locator('.side-nav .menu-level-one').filter({ hasText: '商品管理' });
  const second = page
    .locator('.t-popup:not(.t-menu-is-nested) > .t-menu__popup:visible')
    .filter({ hasText: '商品公共基础数据' });
  await trigger.locator('.t-icon').first().hover();
  await expect(second).toBeVisible();
  const origin = (await trigger.boundingBox())!;
  const target = (await second.boundingBox())!;
  for (let step = 1; step <= 12; step++) {
    const ratio = step / 12;
    await page.mouse.move(
      origin.x + origin.width / 2 + (target.x + target.width / 2 - origin.x - origin.width / 2) * ratio,
      origin.y + origin.height / 2 + (target.y + target.height - 16 - origin.y - origin.height / 2) * ratio,
    );
    await page.waitForTimeout(30);
  }
  await expect(second).toBeVisible();
});

test('store permission popup remains usable when the active page is a product submenu', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'admin',
        name: '门店管理员',
        tenantId: 1,
        storeId: 2,
        storeType: 'cityPartner',
        roles: ['STORE_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto(productWarehouseUrl('/store/finished-stock-management'));
  await page.addStyleTag({ content: '.t-menu__spacer::before { pointer-events: none !important; }' });
  const trigger = page.locator('.side-nav .menu-level-one').filter({ hasText: '权限管理' });
  const panel = page.locator('.t-menu__popup:visible').filter({ hasText: '员工管理' });
  await crossPopupGap(page, trigger, panel);
  const bounds = (await panel.boundingBox())!;
  for (const [x, y] of [
    [bounds.x + 1, bounds.y + 1],
    [bounds.x + bounds.width - 1, bounds.y + bounds.height - 1],
  ]) {
    await page.mouse.move(x, y, { steps: 10 });
    await page.waitForTimeout(200);
    await expect(panel).toBeVisible();
  }
});

test('hover continuity does not depend on pseudo-element hit testing', async ({ page }) => {
  await page.addStyleTag({ content: '.t-menu__spacer::before { pointer-events: none !important; }' });
  const trigger = page.locator('.side-nav .menu-level-one').filter({ hasText: '商品管理' });
  const panel = page
    .locator('.t-popup:not(.t-menu-is-nested) > .t-menu__popup:visible')
    .filter({ hasText: '商品公共基础数据' });
  await crossPopupGap(page, trigger, panel);
  const nested = panel.locator('.menu-level-two').filter({ hasText: '商品公共基础数据' });
  const third = page.locator('.t-popup.t-menu-is-nested > .t-menu__popup:visible').filter({ hasText: '属性库管理' });
  await crossPopupGap(page, nested, third);
});

test('supply-chain multi-level menus keep the hover corridor and original navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        clientCode: 'supply-chain',
        name: '供应链管理员',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });
  await page.goto(productWarehouseUrl('/supply-chain/finished-stock-management'));
  await page.addStyleTag({ content: '.t-menu__spacer::before { pointer-events: none !important; }' });
  const trigger = page.locator('.side-nav .menu-level-one').filter({ hasText: '商品管理' });
  const panel = page
    .locator('.t-popup:not(.t-menu-is-nested) > .t-menu__popup:visible')
    .filter({ hasText: '大板管理' });
  await crossPopupGap(page, trigger, panel);
  await panel.getByText('大板管理', { exact: true }).click();
  await expect(page).toHaveURL(/\/supply-chain\/slab-management$/);
});

test('expanded sidebars retain normal inline menus without hover bridge hit targets', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 858 });
  await page.goto(productWarehouseUrl('/product-attribute'));
  await expect(page.locator('.side-nav .zdm-menu-hover-bridge:visible')).toHaveCount(0);
  await page.locator('.side-nav').getByText('商品分类管理', { exact: true }).click();
  await expect(page).toHaveURL(/\/product-category$/);
});
