import { productWarehouseUrl } from './product-test-navigation';
import { expect, test } from '@playwright/test';

import { installAdminApiMocks } from './admin-api-mocks';

test('shows the login page', async ({ page }) => {
  await page.goto(productWarehouseUrl('/login'));
  await expect(page.getByRole('heading', { name: '欢迎登录' })).toBeVisible();
  await expect(page.getByPlaceholder('请输入手机号')).toHaveValue('');
  await expect(page.getByPlaceholder('请输入验证码')).toHaveValue('');
});

test('stores and displays the logged-in user', async ({ page }) => {
  await installAdminApiMocks(page);
  await page.route('**/api/admin/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          token: 'dev-token:2',
          user: {
            id: 2,
            name: '测试员工',
            phone: '15900000001',
            roles: ['OPERATION_MANAGER'],
            roleNames: ['运营经理'],
            identityType: 'platform_admin',
            permissions: ['admin.permission-management.employee-management.view'],
          },
        },
      }),
    });
  });

  await page.goto(productWarehouseUrl('/login'));
  await page.getByPlaceholder('请输入手机号').fill('15900000001');
  await page.getByPlaceholder('请输入验证码').fill('888888');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL(/\/employee-management$/);
  await expect(page.locator('.top-nav .user-name')).toHaveText('测试员工');
  await expect(page.locator('.top-nav .user-role')).toHaveText('运营经理');
  await expect(page.locator('.top-nav .user-meta')).toHaveCSS('flex-direction', 'row');
});

test('logs out and clears the local account session', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('zdm-admin-token', 'dev-token:1');
    window.localStorage.setItem(
      'zdm-admin-user',
      JSON.stringify({
        id: 1,
        name: '超级管理员',
        phone: '15926626945',
        roles: ['SUPER_ADMIN'],
        permissions: ['all'],
        dataPermission: 'all',
      }),
    );
  });

  await page.goto(productWarehouseUrl('/dashboard'));
  await page.getByRole('button', { name: /退出登录/ }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '欢迎登录' })).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem('zdm-admin-token'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem('zdm-admin-user'))).toBeNull();
});

test('built-in super admin switches to the supply-chain system with full scoped access', async ({ page }) => {
  await installAdminApiMocks(page);
  const contexts = [
    { identityId: 1, identityType: 'platform_admin', clientCode: 'admin', tenantId: null, storeId: null },
    { identityId: 2, identityType: 'platform_admin', clientCode: 'supply-chain', tenantId: null, storeId: null },
  ];
  await page.route('**/api/admin/auth/contexts', (route) => route.fulfill({ json: { code: 0, data: contexts } }));
  await page.route('**/api/admin/auth/switch-identity', (route) =>
    route.fulfill({
      json: {
        code: 0,
        data: {
          token: 'supply-chain-super-admin-token',
          user: {
            id: 1,
            identityId: 2,
            identityType: 'platform_admin',
            clientCode: 'supply-chain',
            name: '超级管理员',
            phone: '15926626945',
            roles: ['SUPER_ADMIN'],
            permissions: ['all'],
            dataPermission: 'all',
          },
        },
      },
    }),
  );
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('zdm-admin-token')) {
      window.localStorage.setItem('zdm-admin-token', 'admin-super-admin-token');
      window.localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          identityId: 1,
          identityType: 'platform_admin',
          clientCode: 'admin',
          name: '超级管理员',
          phone: '15926626945',
          roles: ['SUPER_ADMIN'],
          permissions: ['all'],
          dataPermission: 'all',
        }),
      );
    }
  });

  await page.goto(productWarehouseUrl('/dashboard'));
  const identityNavigations: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) identityNavigations.push(request.url());
  });
  await page.locator('.brand-context-select').click();
  await Promise.all([page.waitForEvent('load'), page.getByText('供应链协同系统', { exact: true }).click()]);
  expect(identityNavigations).toHaveLength(1);
  await expect(page.locator('.brand-context-label .identity-name')).toHaveText('供应链协同系统');
  await page.locator('.side-nav').getByText('商品管理', { exact: true }).click();
  await expect(page.locator('.side-nav [data-menu-path="/supply-chain/finished-stock-management"]')).toBeVisible();
  await expect(page.locator('.side-nav [data-menu-path="/supply-chain/slab-management"]')).toBeVisible();
  await expect(page.locator('.side-nav [data-menu-path="/finished-stock-management"]')).toHaveCount(0);
  await expect(page.locator('.side-nav [data-menu-path="/tenant-management"]')).toHaveCount(0);
});

for (const storeCount of [1, 2]) {
  test(`shows only stores in the brand switcher with ${storeCount} stores`, async ({ page }) => {
    await installAdminApiMocks(page);
    await page.route('**/api/admin/auth/contexts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          message: 'ok',
          data: [
            {
              identityId: 1,
              identityType: 'tenant_admin',
              tenantId: 1,
              storeId: null,
              tenantName: '华东石材',
              storeName: null,
              storeType: null,
            },
            {
              identityId: 11,
              identityType: 'store_admin',
              tenantId: 1,
              storeId: 1,
              tenantName: '华东石材',
              storeName: '杭州体验门店',
              storeType: 'cityPartner',
            },
            {
              identityId: 12,
              identityType: 'store_admin',
              tenantId: 1,
              storeId: 2,
              tenantName: '华东石材',
              storeName: '宁波体验门店',
              storeType: 'cityPartner',
            },
          ].slice(0, storeCount + 1),
        }),
      });
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('zdm-admin-token', 'dev-token:1');
      window.localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 1,
          identityId: 11,
          identityType: 'store_admin',
          tenantId: 1,
          tenantName: '华东石材',
          storeId: 1,
          storeName: '杭州体验门店',
          storeType: 'cityPartner',
          name: '超级管理员',
          phone: '15926626945',
          roles: ['SUPER_ADMIN'],
          permissions: ['all'],
          dataPermission: 'all',
        }),
      );
    });

    await page.goto(productWarehouseUrl('/dashboard'));

    await expect(page.locator('.top-actions .t-select')).toHaveCount(0);
    if (storeCount === 1) {
      await expect(page.locator('.brand-subtitle')).toContainText('杭州体验门店');
      await expect(page.locator('.brand-subtitle .identity-type')).toHaveText('门店端 · 合伙人门店');
      await expect(page.locator('.top-nav .t-tag')).toHaveCount(0);
      await expect(page.locator('.brand-context-select')).toHaveCount(0);
    } else {
      await expect(page.locator('.brand-context-select')).toBeVisible();
      await page.locator('.brand-context-select').click();
      await expect(page.getByText('华东石材', { exact: true })).toHaveCount(0);
      await expect(page.getByText('宁波体验门店', { exact: true })).toBeVisible();
      const option = page.locator('.t-select-option').filter({ hasText: '宁波体验门店' });
      await expect(option.locator('.identity-name')).toHaveText('宁波体验门店');
      await expect(option.locator('.identity-type')).toHaveText('门店端 · 合伙人门店');
      await expect(page.locator('.t-select-option .identity-current-check')).toHaveCount(1);
      await expect(
        page.locator('.t-select-option').filter({ hasText: '杭州体验门店' }).locator('.identity-current-check'),
      ).toBeVisible();
      const nameBox = await option.locator('.identity-name').boundingBox();
      const typeBox = await option.locator('.identity-type').boundingBox();
      expect(typeBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
      const rowBox = await option.boundingBox();
      expect(rowBox!.height).toBeGreaterThanOrEqual(nameBox!.height + typeBox!.height + 8);
      expect(typeBox!.y + typeBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height - 4);
      const options = page.locator('.t-select-option');
      for (let index = 0; index < (await options.count()); index++) {
        const row = options.nth(index);
        const box = await row.boundingBox();
        const detail = await row.locator('.identity-type').boundingBox();
        expect(detail!.y + detail!.height).toBeLessThanOrEqual(box!.y + box!.height - 4);
        if (index > 0) {
          const previous = await options.nth(index - 1).boundingBox();
          expect(box!.y).toBeGreaterThanOrEqual(previous!.y + previous!.height);
        }
      }
      const current = options.filter({ hasText: '杭州体验门店' });
      const currentBox = await current.boundingBox();
      const checkBox = await current.locator('.identity-current-check').boundingBox();
      expect(currentBox!.x + currentBox!.width - checkBox!.x - checkBox!.width).toBeLessThanOrEqual(16);
      await expect(page.locator('.identity-context-input')).toHaveClass(/t-input--borderless/);
      await expect(page.locator('.identity-context-input')).toHaveCSS('outline-style', 'none');
      await expect(page.locator('.identity-trigger-icon')).toHaveCSS('width', '32px');
      await expect(current.locator('.identity-option-icon')).toHaveCSS('width', '40px');
      await expect(page.locator('.identity-panel-heading')).toHaveText('切换身份');
      await expect(page.locator('.identity-trigger-icon [data-kind="storefront"]')).toBeVisible();
      await expect(current.locator('.identity-option-icon [data-kind="storefront"]')).toBeVisible();
      await expect(current).toHaveCSS('background-color', 'rgb(235, 243, 254)');
      await expect(current.locator('.identity-option-icon')).toHaveCSS('background-color', 'rgb(226, 237, 254)');
      const iconBox = await current.locator('.identity-glyph').boundingBox();
      expect(iconBox!.width).toBe(24);
      expect(iconBox!.height).toBe(24);
      expect(currentBox!.height).toBe(64);
      const brandBox = await page.locator('.identity-brand').boundingBox();
      const triggerBox = await page.locator('.brand-context-select').boundingBox();
      expect(triggerBox!.x - brandBox!.x - brandBox!.width).toBeLessThanOrEqual(48);
      const panel = page.locator('.zdm-identity-popup');
      await expect
        .poll(async () => {
          const box = await panel.boundingBox();
          return Math.abs(box!.x - triggerBox!.x - 48);
        })
        .toBeLessThanOrEqual(2);
      const panelBox = await panel.boundingBox();
      expect(Math.abs(panelBox!.y - triggerBox!.y - triggerBox!.height - 4)).toBeLessThanOrEqual(2);
      const arrowBox = await page.locator('.identity-toggle').boundingBox();
      const currentNameBox = await page.locator('.brand-context-label .identity-name').boundingBox();
      expect(
        Math.abs(arrowBox!.y + arrowBox!.height / 2 - currentNameBox!.y - currentNameBox!.height / 2),
      ).toBeLessThanOrEqual(1);
      expect(arrowBox!.x - currentNameBox!.x - currentNameBox!.width).toBe(16);
      const actualShadow = await panel.evaluate((element) => getComputedStyle(element).boxShadow);
      // Compare the approved mockup shadow using normalized browser color formatting.
      const expectedShadow = await panel.evaluate((element) => {
        const probe = document.createElement('div');
        probe.style.boxShadow = '0 4px 12px rgb(0 0 0 / 10%)';
        element.appendChild(probe);
        const result = getComputedStyle(probe).boxShadow;
        probe.remove();
        return result;
      });
      expect(actualShadow).toBe(expectedShadow);
      await expect(option.locator('.identity-name')).toHaveCSS('font-size', '14px');
      await expect(option.locator('.identity-type')).toHaveCSS('font-size', '12px');
    }
  });
}

for (const platformIdentityType of ['platform_admin', 'employee']) {
  test(`switches among platform, partner, suppliers and factory for ${platformIdentityType}`, async ({ page }) => {
    await installAdminApiMocks(page);
    const contexts = [
      { identityId: 21, identityType: platformIdentityType, clientCode: 'admin', tenantId: null, storeId: null },
      {
        identityId: 22,
        identityType: 'tenant_admin',
        clientCode: 'admin',
        tenantId: 1,
        tenantName: '测试租户',
        storeId: null,
      },
      {
        identityId: 23,
        identityType: 'store_admin',
        clientCode: 'admin',
        tenantId: 1,
        tenantName: '测试租户',
        storeId: 1,
        storeName: '测试城市合伙人门店',
        storeType: 'cityPartner',
      },
      ...[
        { storeType: 'slabSupplier', storeName: '测试大板供应商' },
        { storeType: 'finishedSupplier', storeName: '测试成品供应商' },
        { storeType: 'factory', storeName: '测试工厂' },
      ].map((store, index) => ({
        identityId: 24 + index,
        identityType: 'store_admin',
        clientCode: 'admin',
        tenantId: 2 + index,
        tenantName: `测试经营主体${index}`,
        storeId: 2 + index,
        ...store,
      })),
    ];
    const user = {
      id: 2,
      name: '多身份测试账号',
      phone: '15900000001',
      roles: ['SUPER_ADMIN'],
      permissions: ['all'],
      dataPermission: 'all',
    };
    const switchedIds: number[] = [];
    await page.route('**/api/admin/auth/contexts', (route) => route.fulfill({ json: { code: 0, data: contexts } }));
    await page.route('**/api/admin/auth/switch-identity', async (route) => {
      const identityId = route.request().postDataJSON().identityId;
      switchedIds.push(identityId);
      const context = contexts.find((entry) => entry.identityId === identityId);
      await route.fulfill({
        json: { code: 0, data: { token: 'mock-dual-identity-token', user: { ...user, ...context } } },
      });
    });
    await page.addInitScript(
      (initialUser) => {
        if (!window.localStorage.getItem('zdm-admin-token')) {
          window.localStorage.setItem('zdm-admin-token', 'mock-dual-identity-token');
          window.localStorage.setItem('zdm-admin-user', JSON.stringify(initialUser));
        }
      },
      { ...user, ...contexts[2] },
    );
    await page.goto(productWarehouseUrl('/dashboard'));
    for (const [label, type] of [
      ['运营管理平台', '运营端'],
      ['测试大板供应商', '门店端 · 大板供应商'],
      ['测试成品供应商', '门店端 · 成品供应商'],
      ['测试工厂', '门店端 · 工厂'],
      ['测试城市合伙人门店', '门店端 · 合伙人门店'],
    ]) {
      await page.locator('.brand-context-select').click();
      await expect(page.getByText('测试租户', { exact: true })).toHaveCount(0);
      const section = page.locator('.t-select-option').filter({ has: page.locator('.identity-section-start') });
      const sectionBox = await section.boundingBox();
      const precedingBox = await section.locator('xpath=preceding-sibling::li[1]').boundingBox();
      expect(sectionBox!.y - precedingBox!.y - precedingBox!.height).toBeGreaterThanOrEqual(16);
      if (platformIdentityType === 'platform_admin' && label === '运营管理平台') {
        await expect(page.locator('.identity-option-icon [data-kind="city-8"]')).toBeVisible();
        await expect(page.locator('.identity-option-icon [data-kind="city"]')).toBeVisible();
        await expect(page.locator('.identity-toggle')).toBeVisible();
        const displayedName = page.locator('.brand-context-label .identity-name');
        expect(await displayedName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({
          path: test.info().outputPath('identity-switcher.png'),
          animations: 'disabled',
          clip: { x: 0, y: 0, width: 900, height: 600 },
        });
      }
      // Identity switching starts one full document navigation; subscribe before clicking.
      await Promise.all([page.waitForEvent('load'), page.getByText(label, { exact: true }).click()]);
      await expect(page.locator('.brand-context-label .identity-name')).toHaveText(label);
      await expect(page.locator('.brand-context-label .identity-type')).toHaveText(type);
      const icon = type.includes('工厂') ? 'city' : type.startsWith('门店端') ? 'storefront' : 'city-8';
      await expect(page.locator(`.identity-trigger-icon [data-kind="${icon}"]`)).toBeVisible();
      await expect(page.locator('.top-nav .t-tag')).toHaveCount(0);
      const nameBox = await page.locator('.brand-context-label .identity-name').boundingBox();
      const typeBox = await page.locator('.brand-context-label .identity-type').boundingBox();
      expect(typeBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
      const inputBox = await page.locator('.identity-context-input').boundingBox();
      expect(typeBox!.y + typeBox!.height).toBeLessThanOrEqual(inputBox!.y + inputBox!.height);
    }
    expect(switchedIds).toEqual([21, 24, 25, 26, 23]);
  });
}

test('submit validation uses one summary and both inline errors without sending a login request', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/admin/auth/login', async (route) => {
    requests++;
    await route.fulfill({ json: { code: 400, message: '不应提交空表单' } });
  });
  await page.goto(productWarehouseUrl('/login'));
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.zdm-admin-feedback')).toHaveText('表单校验未通过，请检查标红字段');
  for (const field of ['phone', 'verifyCode']) {
    const item = page.locator(`.t-form-item__${field}`);
    const color = await item.locator('.t-input__extra').evaluate((element) => getComputedStyle(element).color);
    await expect(item.locator('.t-input')).toHaveCSS('border-top-color', color);
  }
  await expect(page.locator('.t-form-item__phone')).toContainText('请输入手机号');
  await expect(page.locator('.t-form-item__verifyCode')).toContainText('请输入验证码');
  expect(requests).toBe(0);
  await expect(page).toHaveURL(/\/login$/);
});

test('two-line identity selection retains the current identity and permissions after a failed switch', async ({
  page,
}) => {
  await installAdminApiMocks(page);
  const user = {
    id: 1,
    identityId: 11,
    identityType: 'store_admin',
    tenantId: 1,
    storeId: 1,
    storeName: '杭州体验门店',
    storeType: 'cityPartner',
    name: '测试用户',
    phone: '15900000001',
    roles: ['SUPER_ADMIN'],
    permissions: ['all'],
    dataPermission: 'all',
  };
  const contexts = [
    {
      identityId: 11,
      identityType: 'store_admin',
      tenantId: 1,
      storeId: 1,
      storeName: '杭州体验门店',
      storeType: 'cityPartner',
    },
    {
      identityId: 12,
      identityType: 'store_admin',
      tenantId: 1,
      storeId: 2,
      storeName: '测试工厂',
      storeType: 'factory',
    },
  ];
  await page.route('**/api/admin/auth/contexts', (route) => route.fulfill({ json: { code: 0, data: contexts } }));
  const writes: number[] = [];
  let releaseSwitch!: () => void;
  const pendingSwitch = new Promise<void>((resolve) => {
    releaseSwitch = resolve;
  });
  await page.route('**/api/admin/auth/switch-identity', async (route) => {
    writes.push(route.request().postDataJSON().identityId);
    await pendingSwitch;
    return route.fulfill({ status: 400, json: { code: 400, message: '模拟切换失败', data: null } });
  });
  await page.addInitScript((initial) => {
    localStorage.setItem('zdm-admin-token', 'identity-layout-token');
    localStorage.setItem('zdm-admin-user', JSON.stringify(initial));
  }, user);
  await page.goto(productWarehouseUrl('/dashboard'));
  await page.locator('.brand-context-select').click();
  await page.locator('.t-select-option').filter({ hasText: '测试工厂' }).click();
  try {
    await expect(page.locator('.brand-context-select[aria-busy="true"]')).toBeVisible();
    await expect(page.locator('.brand-context-select .t-loading')).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zdm-admin-user')!).identityId)).toBe(11);
  } finally {
    releaseSwitch();
  }
  await expect(page.getByText('模拟切换失败', { exact: true })).toBeVisible();
  expect(writes).toEqual([12]);
  await expect(page.locator('.brand-context-label .identity-name')).toHaveText('杭州体验门店');
  await expect(page.locator('.brand-context-label .identity-type')).toHaveText('门店端 · 合伙人门店');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('zdm-admin-user')!))).toEqual(user);
  await page.locator('.brand-context-select').click();
  const current = page.locator('.t-select-option').filter({ hasText: '杭州体验门店' });
  await expect(current).toHaveClass(/t-is-selected/);
  await expect(current.locator('.identity-current-check')).toBeVisible();
  await expect(page.locator('.t-select-option .identity-current-check')).toHaveCount(1);
});

for (const storeCount of [1, 2]) {
  test(`identity layout contains long names with ${storeCount} contexts`, async ({ page }) => {
    await installAdminApiMocks(page);
    const longName = '杭州旗舰石材家居体验门店超长名称用于验证完整身份信息展示';
    const user = {
      id: 1,
      identityId: 11,
      identityType: 'store_admin',
      tenantId: 1,
      storeId: 1,
      storeName: longName,
      storeType: 'cityPartner',
      name: '测试用户',
      phone: '15900000001',
      roles: ['SUPER_ADMIN'],
      permissions: ['all'],
      dataPermission: 'all',
    };
    const contexts = Array.from({ length: storeCount }, (_, index) => ({
      ...user,
      identityId: 11 + index,
      storeId: 1 + index,
    }));
    await page.route('**/api/admin/auth/contexts', (route) => route.fulfill({ json: { code: 0, data: contexts } }));
    await page.addInitScript((initial) => {
      localStorage.setItem('zdm-admin-token', 'long-name-token');
      localStorage.setItem('zdm-admin-user', JSON.stringify(initial));
    }, user);
    await page.setViewportSize({ width: 1000, height: 780 });
    await page.goto(productWarehouseUrl('/dashboard'));
    const title = page.locator('.identity-context .identity-name');
    await expect(title).toHaveAttribute('title', longName);
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    const contextBox = await page.locator('.identity-context').boundingBox();
    const textBox = await title.boundingBox();
    expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(contextBox!.x + contextBox!.width);
    if (storeCount === 2) {
      await page.locator('.brand-context-select').click();
      const arrowBox = await page.locator('.identity-toggle').boundingBox();
      expect(arrowBox!.x + arrowBox!.width).toBeLessThanOrEqual(contextBox!.x + contextBox!.width);
      await expect(page.locator('.identity-context-input')).toHaveCSS('outline-style', 'none');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('.identity-context-input')).toHaveCSS('outline-style', 'solid');
    }
  });
}
