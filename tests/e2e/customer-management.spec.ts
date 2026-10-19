import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
import { expectOfficialLayout } from './filter-layout-assertions';
const prefix = 'store.customer-management';
const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
const customer = (id: number, ownerAccountId: number, status = 'daily') => ({
  id,
  tenantId: 1,
  storeId: 2,
  name: `王先生${id}`,
  phone: '',
  nationality: '',
  phoneRegion: '',
  callingCode: '',
  wechat: '',
  requirement: '餐桌',
  remark: '',
  ownerAccountId,
  ownerName: ownerAccountId === 7 ? '导购A' : '导购B',
  createdByAccountId: 7,
  createdByName: '导购A',
  createdAt: '2026-10-13T10:00:00',
  status,
});
async function setup(page: Page, grants: string[], scope = 'all', empty = false) {
  await installAdminApiMocks(page);
  await page.addInitScript(
    ({ grants, scope }) => {
      localStorage.setItem('zdm-admin-token', 'dev-token');
      localStorage.setItem(
        'zdm-admin-user',
        JSON.stringify({
          id: 7,
          identityId: 7,
          name: '导购A',
          clientCode: 'admin',
          tenantId: 1,
          storeId: 2,
          storeType: 'cityPartner',
          roles: [],
          permissions: grants,
          dataPermission: scope,
        }),
      );
    },
    { grants: grants.map((g) => `${prefix}.${g}`), scope },
  );
  let records = empty ? [] : [customer(1, 7), customer(2, 8), customer(3, 7, 'archived')];
  let followups = [
    {
      id: 11,
      followedAt: '2026-10-13T10:00:00',
      content: '原导购历史跟进',
      nextFollowTask: '',
      createdByAccountId: 8,
      createdByName: '导购B',
      createdAt: '2026-10-13T10:00:00',
      attachments: [],
    },
  ];
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/admin/store-customers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/contact-regions'))
      return route.fulfill({
        json: ok({
          nationalities: [
            { code: 'CN', name: '中国' },
            { code: 'FR', name: '法国' },
            { code: 'US', name: '美国' },
          ],
          phoneRegions: [
            { code: 'CN', name: '中国', callingCode: '+86' },
            { code: 'FR', name: '法国', callingCode: '+33' },
            { code: 'US', name: '美国', callingCode: '+1' },
          ],
        }),
      });
    if (path.endsWith('/owners') || path.endsWith('/owner-candidates'))
      return route.fulfill({
        json: ok([
          { accountId: 7, name: '导购A', active: true },
          { accountId: 8, name: '导购B', active: true },
        ]),
      });
    if (path.endsWith('/batch') || path.endsWith('/action')) {
      const body = request.postDataJSON();
      requests.push(body);
      records = records.flatMap((c) =>
        !body.ids.includes(c.id)
          ? [c]
          : body.action === 'purge'
            ? []
            : [
                {
                  ...c,
                  status: body.action === 'archive' ? 'archived' : 'daily',
                  ownerAccountId: body.action === 'assign' ? body.ownerAccountId : c.ownerAccountId,
                },
              ],
      );
      return route.fulfill({ json: ok(true) });
    }
    if (path.endsWith('/attachments') && request.method() === 'POST') {
      requests.push({ upload: true });
      return route.fulfill({
        json: ok({
          id: 100 + requests.length,
          mediaType: request.postDataBuffer()?.toString().includes('Content-Type: image/') ? 'image' : 'file',
          mimeType: 'application/octet-stream',
        }),
      });
    }
    if (path.includes('/followups')) {
      if (request.method() === 'DELETE') followups = [];
      else {
        const body = request.postDataJSON();
        requests.push(body);
        followups = [{ ...followups[0], ...body }];
      }
      return route.fulfill({ json: ok(true) });
    }
    const id = Number(path.split('/').at(-1));
    const callingCode = (region: string) => ({ CN: '+86', FR: '+33', US: '+1' })[region] ?? '';
    if (id && request.method() === 'PUT') {
      const body = request.postDataJSON();
      requests.push(body);
      records = records.map((c) =>
        c.id === id
          ? {
              ...c,
              ...body,
              callingCode: callingCode(body.phoneRegion),
              ownerName: body.ownerAccountId === 7 ? '导购A' : '导购B',
            }
          : c,
      );
      return route.fulfill({ json: ok(records.find((c) => c.id === id)) });
    }
    if (id) return route.fulfill({ json: ok({ customer: records.find((c) => c.id === id), followups }) });
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.push(body);
      const c = { ...customer(4, 7), ...body, callingCode: callingCode(body.phoneRegion) };
      records.push(c);
      return route.fulfill({ json: ok(c) });
    }
    return route.fulfill({
      json: ok(
        records.filter(
          (c) => c.status === url.searchParams.get('status') && (scope === 'all' || c.ownerAccountId === 7),
        ),
      ),
    });
  });
  return requests;
}
const daily = [
  'daily.view',
  'daily.create',
  'daily.detail',
  'daily.followup',
  'daily.edit',
  'daily.archive',
  'daily.batch-assign',
  'daily.batch-archive',
];
const archived = [
  'archived.view',
  'archived.detail',
  'archived.followup',
  'archived.edit',
  'archived.restore',
  'archived.purge',
  'archived.batch-assign',
  'archived.batch-restore',
  'archived.batch-purge',
];
test('single authorized tab hides tab bar and self scope hides owner filter', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail'], 'self');
  await page.goto('/store/customer-management');
  await expect(page.getByText('王先生1', { exact: true })).toBeVisible();
  await expect(page.locator('.t-tabs')).toHaveCount(0);
  await expect(page.getByText('王先生2', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增', exact: true })).toHaveCount(0);
  await expect(page.locator('.zdm-official-list-page__grid-filters').getByText('归属人', { exact: true })).toHaveCount(
    0,
  );
});
test('all data with grants allows ordinary staff to maintain other owner customers', async ({ page }) => {
  await setup(page, daily);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生2' });
  await expect(row).toBeVisible();
  await expect(row.getByText('调整归属', { exact: true })).toHaveCount(0);
  await expect(row.getByText('编辑', { exact: true })).toBeVisible();
  await expect(row.getByText('归档', { exact: true })).toBeVisible();
  await row.getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-drawer__content-wrapper:visible').filter({ hasText: '客户详情' });
  await expect(dialog.getByRole('button', { name: '新增跟进', exact: true })).toHaveCount(0);
  await expect(row.getByText('跟进', { exact: true })).toBeVisible();
});
test('new customer requires name and defaults the required owner to self', async ({ page }) => {
  const requests = await setup(page, daily);
  await page.goto('/store/customer-management');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增客户' });
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请输入客户姓名', { exact: true })).toBeVisible();
  await dialog.locator('.t-form__item').filter({ hasText: '客户姓名' }).locator('input').fill('李女士');
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(page.getByText('李女士', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ name: '李女士', phone: '' });
  expect(requests.at(-1)).toHaveProperty('ownerAccountId', 7);
});
test('current owner edits historical followup without a separate followup grant', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.detail']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const detail = page.locator('.t-drawer__content-wrapper:visible').filter({ hasText: '客户详情' });
  await expect(detail.getByRole('button', { name: '新增跟进', exact: true })).toHaveCount(0);
  await detail.getByText('编辑', { exact: true }).click();
  const edit = page.locator('.t-dialog:visible').filter({ hasText: '编辑跟进' });
  await edit.locator('textarea').first().fill('接手后补充');
  await edit
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(detail.getByText('接手后补充', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ content: '接手后补充', mediaIds: [] });
});
test('archive assignment is independent of role and returns the customer to daily', async ({ page }) => {
  const requests = await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await page.getByText('归档客户', { exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生3' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量调整归属', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '调整归属' });
  await expect(dialog.getByText('调整归属后，客户将自动恢复为日常客户。')).toBeVisible();
  await dialog.locator('.t-select').click();
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(page.getByText('王先生3', { exact: true })).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ action: 'assign', status: 'archived', ownerAccountId: 8 });
  await page.getByText('日常客户', { exact: true }).click();
  await expect(page.getByText('王先生3', { exact: true })).toBeVisible();
});

test('followup accepts at most three attachments and blocks files above 5MiB before upload', async ({
  page,
}, testInfo) => {
  const requests = await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' }).last();
  const inputs = dialog.locator('input[type=file]');
  await expect(inputs).toHaveCount(3);
  await inputs.first().setInputFiles({
    name: 'large.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/附件不能超过5MiB/)).toBeVisible();
  expect(requests.filter((item) => item.upload)).toHaveLength(0);
  await dialog.screenshot({ path: testInfo.outputPath('attachment-rejected-size.png'), animations: 'disabled' });
  for (let index = 0; index < 3; index++) {
    await inputs
      .nth(index)
      .setInputFiles({ name: `note${index}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.from('note') });
    await expect(dialog.getByText(`note${index}.bin`, { exact: true })).toBeVisible();
  }
  await dialog.locator('textarea').first().fill('三个附件');
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(requests.some((item) => item.content === '三个附件')).toBe(true);
  expect((requests.at(-1)?.mediaIds as number[]).length).toBe(3);
});

test('a delayed old detail response never replaces the newly opened customer', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/store-customers/1', async (route) => {
    await gate;
    await route.fulfill({ json: ok({ customer: customer(1, 7), followups: [] }) });
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  await page.locator('.t-drawer__content-wrapper:visible').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生2' }).getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-drawer__content-wrapper:visible');
  await expect(dialog.getByText('王先生2', { exact: true })).toBeVisible();
  const response = page.waitForResponse('**/api/admin/store-customers/1');
  release();
  await response;
  await expect(dialog.getByText('王先生2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('王先生1', { exact: true })).toHaveCount(0);
});

test('customer list follows standard spacing with bounded horizontal scrolling at the review viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 858 });
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await expect(page.getByText('王先生1', { exact: true })).toBeVisible();
  const form = page.locator('.zdm-official-list-page__grid-filters');
  await expect(page.locator('body')).toHaveCSS('-webkit-font-smoothing', 'antialiased');
  const reference = await page.context().newPage();
  await reference.goto('/tests/fixtures/official-ui/reference.html');
  const hostWidth = (await page.locator('.zdm-official-list-page').boundingBox())!.width;
  // Compare the original official grid at exactly the same container width.
  await reference.locator('.list-common-table').evaluate((element, width) => {
    (element as HTMLElement).style.width = `${width}px`;
    (element as HTMLElement).style.boxSizing = 'border-box';
  }, hostWidth);
  const expected = await reference.locator('.list-common-table .t-form__label').evaluateAll((elements) =>
    elements.slice(0, 3).map((element) => ({
      width: element.getBoundingClientRect().width,
      padding: getComputedStyle(element).paddingRight,
    })),
  );
  const actual = await form.locator('.t-form__label').evaluateAll((elements) =>
    elements.map((element) => ({
      width: element.getBoundingClientRect().width,
      padding: getComputedStyle(element).paddingRight,
    })),
  );
  expect(actual).toEqual(expected);
  await reference
    .locator('.list-common-table')
    .screenshot({ path: testInfo.outputPath('official-grid-form.png'), animations: 'disabled' });
  const referenceContainer = await reference.locator('.list-common-table').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      padding: style.padding,
      radius: style.borderRadius,
      background: style.backgroundColor,
      font: style.font,
      family: style.fontFamily,
      color: style.color,
    };
  });
  expect(
    await page.locator('.zdm-official-list-page').evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        padding: style.padding,
        radius: style.borderRadius,
        background: style.backgroundColor,
        font: style.font,
        family: style.fontFamily,
        color: style.color,
      };
    }),
  ).toEqual(referenceContainer);
  const sectionGap = await reference
    .locator('.table-container')
    .evaluate((element) => parseFloat(getComputedStyle(element).marginTop));
  const referenceControls = await reference
    .locator('.list-common-table .t-input')
    .evaluateAll((elements) => elements.slice(0, 3).map((element) => element.getBoundingClientRect().width));
  const actualControls = await form
    .locator('.t-input')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(actualControls).toHaveLength(referenceControls.length);
  actualControls.forEach((width, index) => expect(width).toBeCloseTo(referenceControls[index], 0));
  const nativeLabelStyles = await reference
    .locator('.list-common-table .t-form__label')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, font: style.font, align: style.textAlign, padding: style.paddingRight };
    });
  expect(
    await form
      .locator('.t-form__label')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, font: style.font, align: style.textAlign, padding: style.paddingRight };
      }),
  ).toEqual(nativeLabelStyles);
  const formBox = (await form.boundingBox())!;
  const firstLabel = (await form.locator('.t-form__label').first().boundingBox())!;
  expect(Math.abs(firstLabel.x - formBox.x)).toBeLessThanOrEqual(1);
  const query = (await form.getByRole('button', { name: '查询', exact: true }).boundingBox())!;
  const reset = (await form.getByRole('button', { name: '重置', exact: true }).boundingBox())!;
  expect(Math.abs(query.y - reset.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(formBox.x + formBox.width - reset.x - reset.width)).toBeLessThanOrEqual(1);
  await reference.close();
  const operationRow = (await page.locator('.zdm-official-list-page__operations').boundingBox())!;
  expect(Math.abs(operationRow.y - formBox.y - formBox.height - sectionGap)).toBeLessThanOrEqual(1);
  const buttons = await page.locator('.zdm-official-list-page__operations .t-button').all();
  for (let i = 1; i < buttons.length; i++) {
    const previous = (await buttons[i - 1].boundingBox())!;
    const next = (await buttons[i].boundingBox())!;
    expect(Math.abs(next.x - previous.x - previous.width - 8)).toBeLessThanOrEqual(1);
  }
  for (const [label, image] of [
    ['日常客户', 'daily'],
    ['归档客户', 'archived'],
  ] as const) {
    await page.locator('.t-tabs').getByText(label, { exact: true }).click();
    await expect(page.getByText(image === 'daily' ? '王先生1' : '王先生3', { exact: true })).toBeVisible();
    const dimensions = await page
      .locator('.t-table__content')
      .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
    await expect(page.locator('symbol#t-icon-add')).toBeAttached({ timeout: 15000 });
    await page.screenshot({
      path: testInfo.outputPath(`customer-list-${image}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await setup(page, [...daily, ...archived], 'all', true);
  await page.reload();
  await expect(page.getByText('暂无客户', { exact: true })).toBeVisible();
  const emptyTable = await page
    .locator('.t-table__content')
    .evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(emptyTable.scroll).toBeGreaterThanOrEqual(emptyTable.width);
  await expect(page.locator('symbol#t-icon-add')).toBeAttached({ timeout: 15000 });
  await page.screenshot({
    path: testInfo.outputPath('customer-list-empty.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

// Native component reference imports no application stylesheet or foundation wrapper.
async function nativeDialogVisuals(page: Page, testInfo: TestInfo) {
  const reference = await page.context().newPage();
  await reference.goto('/tests/fixtures/official-ui/reference.html?mode=dialog');
  const native = reference.locator('.t-dialog:visible');
  await native.screenshot({ path: testInfo.outputPath('official-native-dialog.png'), animations: 'disabled' });
  // Keep the application foreground after capturing the independent native reference.
  await page.bringToFront();
  const styleOf = async (locator: ReturnType<Page['locator']>) =>
    locator.first().evaluate((element) => {
      const s = getComputedStyle(element);
      return {
        font: s.font,
        color: s.color,
        background: s.backgroundColor,
        padding: s.padding,
        border: s.border,
        radius: s.borderRadius,
        lineHeight: s.lineHeight,
        smoothing: s.getPropertyValue('-webkit-font-smoothing'),
      };
    });
  const checkDialog = async (title: string, image: string, fields: boolean) => {
    const dialog = page.locator('.t-dialog:visible').filter({ hasText: title }).last();
    await expect(dialog).toBeVisible();
    await page.mouse.move(0, 0);
    await reference.mouse.move(0, 0);
    await page.bringToFront();
    for (const selector of ['.t-dialog__header', '.t-dialog__body', '.t-dialog__footer', '.t-button--variant-base'])
      await expect.poll(() => styleOf(dialog.locator(selector))).toEqual(await styleOf(native.locator(selector)));
    const confirmationContent = dialog.locator('.zdm-admin-confirm-dialog__content');
    if (await confirmationContent.count()) {
      await expect(dialog).toHaveCSS('width', await native.evaluate((element) => getComputedStyle(element).width));
      await expect(confirmationContent).toHaveCSS('color', (await styleOf(native.locator('.t-dialog__body'))).color);
    }
    if (fields) {
      expect(await styleOf(dialog.locator('.t-form__label'))).toEqual(await styleOf(native.locator('.t-form__label')));
      for (const selector of ['.t-input', '.t-textarea__inner', '.t-upload', '.t-date-picker', '.t-select']) {
        if (await dialog.locator(selector).count())
          await expect.poll(() => styleOf(dialog.locator(selector))).toEqual(await styleOf(native.locator(selector)));
      }
    }
    await dialog.screenshot({ path: testInfo.outputPath(image + '.png'), animations: 'disabled' });
    return dialog;
  };
  return { reference, native, styleOf, checkDialog };
}

test('customer profile dialogs retain native component visuals', async ({ page }, testInfo) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  const { reference, checkDialog, native, styleOf } = await nativeDialogVisuals(page, testInfo);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  let dialog = await checkDialog('新增客户', 'profile-create', true);
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请输入客户姓名', { exact: true })).toBeVisible();
  expect(await styleOf(dialog.locator('.t-form-item-tips'))).toEqual(
    await styleOf(native.locator('.t-form-item-tips')),
  );
  await dialog.screenshot({ path: testInfo.outputPath('profile-invalid.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const own = page.locator('tr').filter({ hasText: '王先生1' });
  await own.getByText('编辑', { exact: true }).click();
  dialog = await checkDialog('编辑客户', 'profile-edit', true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await reference.close();
});

test('customer followup dialogs retain native component visuals', async ({ page }, testInfo) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  const { reference, checkDialog, styleOf } = await nativeDialogVisuals(page, testInfo);
  const own = page.locator('tr').filter({ hasText: '王先生1' });
  let dialog: ReturnType<Page['locator']>;
  await own.getByText('详情', { exact: true }).click();
  const detail = page.locator('.t-drawer__content-wrapper:visible').filter({ hasText: '客户详情' });
  await expect(detail.getByText('原导购历史跟进', { exact: true })).toBeVisible();
  const drawerReference = await page.context().newPage();
  await drawerReference.goto('/tests/fixtures/official-ui/reference.html?mode=drawer');
  for (const part of ['header', 'body', 'footer']) {
    expect(await styleOf(detail.locator(`.t-drawer__${part}`))).toEqual(
      await styleOf(drawerReference.locator(`.t-drawer__${part}`)),
    );
  }
  await drawerReference.close();
  expect(await styleOf(detail.locator('.t-descriptions__label'))).toEqual(
    await styleOf(reference.locator('.native-descriptions .t-descriptions__label')),
  );
  await detail.screenshot({ path: testInfo.outputPath('detail-owned.png'), animations: 'disabled' });
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await own.getByText('跟进', { exact: true }).click();
  dialog = await checkDialog('新增跟进', 'followup-create', true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await own.getByText('详情', { exact: true }).click();
  await detail.getByText('编辑', { exact: true }).click();
  dialog = await checkDialog('编辑跟进', 'followup-edit', true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await detail.getByText('删除', { exact: true }).click();
  dialog = page.locator('.t-dialog:visible').filter({ hasText: '是否删除跟进记录' });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('followup-delete.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await reference.close();
});

test('daily customer assignment and confirmations retain native component visuals', async ({ page }, testInfo) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  const { reference, checkDialog } = await nativeDialogVisuals(page, testInfo);
  const own = page.locator('tr').filter({ hasText: '王先生1' });
  let dialog: ReturnType<Page['locator']>;
  await own.getByText('归档', { exact: true }).click();
  dialog = await checkDialog('是否归档', 'archive-single', false);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await own.locator('.t-checkbox').click();
  await expect(own.getByRole('checkbox')).toBeChecked();
  await page.getByRole('button', { name: '批量调整归属', exact: true }).click();
  dialog = await checkDialog('调整归属', 'assign-batch', true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '批量归档', exact: true }).click();
  dialog = await checkDialog('是否归档', 'archive-batch', false);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await reference.close();
});

test('archived customer assignment and confirmations retain native component visuals', async ({ page }, testInfo) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  const { reference, checkDialog, native, styleOf } = await nativeDialogVisuals(page, testInfo);
  let dialog: ReturnType<Page['locator']>;
  await page.getByText('归档客户', { exact: true }).click();
  const archivedRow = page.locator('tr').filter({ hasText: '王先生3' });
  await archivedRow.locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量调整归属', exact: true }).click();
  dialog = await checkDialog('调整归属', 'assign-archived', true);
  expect(await styleOf(dialog.locator('.t-alert'))).toEqual(await styleOf(native.locator('.t-alert')));
  const alert = (await dialog.locator('.t-alert').boundingBox())!;
  const select = (await dialog.locator('.t-select').boundingBox())!;
  const gap = await reference
    .locator('.native-section-gap')
    .evaluate((element) => parseFloat(getComputedStyle(element).gap));
  expect(Math.abs(alert.y - select.y - select.height - gap)).toBeLessThanOrEqual(1);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  for (const label of ['取消归档', '彻底删除']) {
    await archivedRow.getByText(label, { exact: true }).click();
    dialog = page.locator('.t-dialog:visible').filter({ hasText: `是否${label}` });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`archived-${label}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  await expect(archivedRow.getByRole('checkbox')).toBeChecked();
  for (const label of ['批量取消归档', '批量彻底删除']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    dialog = page.locator('.t-dialog:visible').filter({ hasText: `是否${label.slice(2)}` });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
  await reference.close();
});

test('customer attachments retain native replace, remove and image preview behavior', async ({ page }, testInfo) => {
  await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' }).last();
  const input = dialog.locator('input[type=file]').first();
  await input.setInputFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') });
  await expect(dialog.getByText('first.txt', { exact: true })).toBeVisible();
  await input.setInputFiles({ name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('second') });
  await expect(dialog.getByText('second.txt', { exact: true })).toBeVisible();
  await expect(dialog.getByText('first.txt', { exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await dialog.getByText('second.txt', { exact: true }).click();
  expect((await download).suggestedFilename()).toBe('second.txt');
  await dialog.locator('.t-upload__single-input-clear').first().click();
  await expect(dialog.getByText('second.txt', { exact: true })).toHaveCount(0);
  await input.setInputFiles({
    name: 'preview.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(dialog.getByText('preview.png', { exact: true })).toBeVisible();
  const names = await dialog
    .locator('.t-upload__single-input-preview')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(names).toHaveLength(3);
  for (const width of names) expect(width).toBeGreaterThan(200);

  await dialog.screenshot({ path: testInfo.outputPath('attachment-uploaded.png'), animations: 'disabled' });
  await dialog.getByText('preview.png', { exact: true }).click();
  await expect(page.locator('.t-image-viewer')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('attachment-image-preview.png'), animations: 'disabled' });
});

test('customer detail loading and authorized other-owner followups remain visible and bounded', async ({
  page,
}, testInfo) => {
  await setup(page, [...daily, ...archived]);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/store-customers/1', async (route) => {
    await gate;
    await route.fulfill({ json: ok({ customer: customer(1, 7), followups: [] }) });
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const detail = page.locator('.t-drawer__content-wrapper:visible').filter({ hasText: '客户详情' });
  await expect(detail.locator('.t-skeleton')).toBeVisible();
  await detail.screenshot({ path: testInfo.outputPath('detail-loading.png'), animations: 'disabled' });
  release();
  await expect(detail.getByText('暂无跟进记录', { exact: true })).toBeVisible();
  await detail.screenshot({ path: testInfo.outputPath('detail-empty-followups.png'), animations: 'disabled' });
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生2' }).getByText('详情', { exact: true }).click();
  await expect(detail.getByText('王先生2', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '新增跟进', exact: true })).toHaveCount(0);
  await expect(detail.getByText('编辑', { exact: true })).toBeVisible();
  await expect(detail.getByText('删除', { exact: true })).toBeVisible();
  await detail.screenshot({ path: testInfo.outputPath('detail-other-owner.png'), animations: 'disabled' });
});

test('customer query grid uses the accepted adaptive structure at narrow widths', async ({ page }) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  for (const width of [1366, 992, 991, 619, 375]) {
    await page.setViewportSize({ width, height: 858 });
    const form = page.locator('.zdm-official-list-page__grid-filters');
    await expect(form.locator('.filter-fields > .t-form__item')).toHaveCount(3);
    await expectOfficialLayout(page, form.locator('.t-form'));
    await expect(form.locator('.filter-actions')).toBeVisible();
    await expect(page.locator('.side-nav > .t-default-menu')).toHaveClass(
      width <= 991 ? /t-is-collapsed/ : /^(?!.*t-is-collapsed)/,
    );
  }
});

test('followup submission keeps its original rules and displays a field error until content is corrected', async ({
  page,
}) => {
  const requests = await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page
    .locator('.t-dialog:visible')
    .filter({ has: page.locator('.t-dialog__header').filter({ hasText: /^新增跟进$/ }) });
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  const field = dialog
    .locator('.t-form__item')
    .filter({ has: page.locator('.t-form__label').filter({ hasText: '跟进内容' }) });
  await expect(field.getByText('请输入跟进内容', { exact: true })).toBeVisible();
  const errorColor = await field
    .getByText('请输入跟进内容', { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(field.locator('.t-textarea__inner')).toHaveCSS('border-top-color', errorColor);
  expect(requests.some((item) => item.content)).toBe(false);
  await field.locator('textarea').fill('修正后的跟进内容');
  await expect(field.getByText('请输入跟进内容', { exact: true })).toHaveCount(0);
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  expect(requests.at(-1)).toMatchObject({ content: '修正后的跟进内容', mediaIds: [] });
});
test('assignment missing-owner feedback stays at the field and clears after selecting an owner', async ({ page }) => {
  const requests = await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await page.getByText('归档客户', { exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生3' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量调整归属', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '调整归属' });
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog.getByText('请选择新归属人', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: '请选择新归属人' })).toHaveCount(0);
  const errorColor = await dialog
    .getByText('请选择新归属人', { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(dialog.locator('.t-select .t-input')).toHaveCSS('border-top-color', errorColor);
  expect(requests.some((item) => item.action === 'assign')).toBe(false);
  await dialog.locator('.t-select').click();
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await expect(dialog.getByText('请选择新归属人', { exact: true })).toHaveCount(0);
});

test('new customer selects a searchable owner and limits both notes to 100 characters', async ({ page }) => {
  const requests = await setup(page, daily);
  await page.goto('/store/customer-management');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增客户' });
  const owner = dialog.locator('.t-form__item').filter({ has: page.locator('label', { hasText: /^归属人/ }) });
  const name = dialog.locator('.t-form__item').filter({ has: page.locator('label', { hasText: '客户姓名' }) });
  await expect(owner.locator('input')).toHaveValue('导购A');
  // Measure both fields in the same frame while the native dialog may be animating.
  const positions = await page.evaluate(
    ({ owner, name }) => {
      if (!owner || !name) throw new Error('Missing customer form fields');
      return { ownerY: owner.getBoundingClientRect().y, nameY: name.getBoundingClientRect().y };
    },
    { owner: await owner.elementHandle(), name: await name.elementHandle() },
  );
  expect(positions.ownerY).toBeLessThan(positions.nameY);
  await expect(owner.locator('.t-form__label')).toHaveClass(/--required/);
  await owner.locator('.t-select').hover();
  await owner.locator('.t-input__clear').click();
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(owner).toContainText('请选择归属人');
  expect(requests).toHaveLength(0);
  await owner.locator('input').fill('导购B');
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await name.locator('input').fill('指定归属客户');
  for (const label of ['客户需求', '客户备注']) {
    const textarea = dialog
      .locator('.t-form__item')
      .filter({ has: page.locator('label', { hasText: label }) })
      .locator('textarea');
    await textarea.fill('字'.repeat(101));
    await expect(textarea).toHaveValue('字'.repeat(100));
  }
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.at(-1)).toMatchObject({ ownerAccountId: 8, requirement: '字'.repeat(100), remark: '字'.repeat(100) });
});

test('edit owner saves the transfer and the new owner sees the persisted selection', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.edit']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑客户' });
  const owner = dialog.getByPlaceholder('请选择归属人');
  await expect(owner).toHaveValue('导购A');
  await owner.fill('导购B');
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.at(-1)).toMatchObject({ ownerAccountId: 8 });
  const row = page.locator('tr').filter({ hasText: '王先生1' });
  await expect(row).toContainText('导购B');
  await expect(row.getByText('编辑', { exact: true })).toBeVisible();
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    localStorage.setItem('zdm-admin-user', JSON.stringify({ ...stored, id: 8, name: '导购B' }));
  });
  await page.reload();
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('编辑', { exact: true }).click();
  await expect(dialog.getByPlaceholder('请选择归属人')).toHaveValue('导购B');
});
test('edit permission includes owner transfer without retired assignment permission', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.edit']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑客户' });
  await expect(dialog.getByPlaceholder('请选择归属人')).toHaveValue('导购A');
  await expect(dialog.getByPlaceholder('请选择归属人')).toBeEnabled();
  await dialog.getByPlaceholder('请选择归属人').click();
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await dialog.getByPlaceholder('请输入客户姓名').fill('仍归属本人');
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(requests.at(-1)).toMatchObject({ ownerAccountId: 8, name: '仍归属本人' });
});
test('edit transfer removes the customer from the old owner self scope', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.edit'], 'self');
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑客户' });
  await dialog.getByPlaceholder('请选择归属人').fill('导购B');
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('暂无客户', { exact: true })).toBeVisible();
});

test('customer batch buttons use selection and data scope across mixed owners', async ({ page }) => {
  await setup(page, daily);
  await page.goto('/store/customer-management');
  const assign = page.getByRole('button', { name: '批量调整归属', exact: true });
  const archive = page.getByRole('button', { name: '批量归档', exact: true });
  await expect(assign).toBeDisabled();
  await expect(archive).toBeDisabled();
  const own = page.locator('tr').filter({ hasText: '王先生1' }).locator('.t-checkbox');
  const other = page.locator('tr').filter({ hasText: '王先生2' }).locator('.t-checkbox');
  await own.click();
  await expect(assign).toBeEnabled();
  await expect(archive).toBeEnabled();
  await other.click();
  await expect(assign).toBeEnabled();
  await expect(archive).toBeEnabled();
  await own.click();
  await expect(assign).toBeEnabled();
  await expect(archive).toBeEnabled();
  await other.click();
  await expect(assign).toBeDisabled();
  await expect(archive).toBeDisabled();
});

const profileField = (page: Page, label: string) =>
  page.locator('.t-dialog:visible .t-form__item').filter({ has: page.locator('.t-form__label', { hasText: label }) });
async function selectContact(page: Page, label: string, option: string) {
  await profileField(page, label).locator('.t-select').click();
  await page.locator('.t-select-option:visible').getByText(option, { exact: true }).click();
}
test('nationality and phone region are independent and native calling code is read only', async ({ page }) => {
  const requests = await setup(page, daily);
  await page.goto('/store/customer-management');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await selectContact(page, '客户国籍', '法国');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveValue('');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toBeDisabled();
  await expect(page.locator('.zdm-admin-phone-input input').last()).toBeDisabled();
  await expect(page.getByText('请先选择号码归属地', { exact: true })).toBeVisible();
  await selectContact(page, '号码归属地', '中国 +86');
  await expect(page.getByText('请先选择号码归属地', { exact: true })).toHaveCount(0);
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveValue('+86');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveAttribute('readonly', '');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toBeDisabled();
  await selectContact(page, '客户国籍', '美国');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveValue('+86');
  const phone = page.locator('.zdm-admin-phone-input input').last();
  await expect(phone).toBeEnabled();
  await phone.fill('000123');
  await phone.pressSequentially('Ab-+中');
  await expect(phone).toHaveValue('000123');
  await profileField(page, '客户姓名').locator('input').fill('国际客户');
  const sizes = await page.locator('.zdm-admin-phone-input').evaluate((el) => ({
    group: el.getBoundingClientRect().width,
    inputs: [...el.querySelectorAll('.t-input__wrap')].map((input) => input.getBoundingClientRect().width),
  }));
  expect(sizes.inputs).toHaveLength(2);
  expect(sizes.inputs[0]).toBe(80);
  expect(sizes.inputs[1]).toBeGreaterThan(100);
  expect(sizes.inputs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(sizes.group);
  await page.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(page.getByText('国际客户', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ nationality: 'US', phoneRegion: 'CN', phone: '000123' });
  const row = page.locator('tr').filter({ hasText: '国际客户' });
  await expect(row).toContainText('+86 000123');
  await row.getByText('编辑', { exact: true }).click();
  await expect(profileField(page, '客户国籍').locator('input')).toHaveValue('美国');
  await expect(profileField(page, '号码归属地').locator('input')).toHaveValue('中国 +86');
  await expect(phone).toHaveValue('000123');
  await profileField(page, '号码归属地').hover();
  await profileField(page, '号码归属地').locator('.t-input__clear').click();
  await expect(phone).toBeDisabled();
  await expect(page.getByText('请先选择号码归属地', { exact: true })).toBeVisible();
  await expect(phone).toHaveValue('000123');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveValue('');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toHaveAttribute('readonly', '');
  await expect(page.locator('.zdm-admin-phone-input input').first()).toBeDisabled();
  await selectContact(page, '号码归属地', '法国 +33');
  await expect(phone).toBeEnabled();
  await expect(phone).toHaveValue('000123');
});
test('phone entry requires a selected region but never country specific length', async ({ page }) => {
  const requests = await setup(page, daily);
  await page.goto('/store/customer-management');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await profileField(page, '客户姓名').locator('input').fill('短号码客户');
  await expect(page.locator('.zdm-admin-phone-input input').last()).toBeDisabled();
  expect(requests).toHaveLength(0);
  await selectContact(page, '号码归属地', '法国 +33');
  await expect(page.locator('.zdm-admin-phone-input input').last()).toBeEnabled();
  await page.locator('.zdm-admin-phone-input input').last().fill('01');
  await page.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(page.getByText('短号码客户', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ phone: '01', phoneRegion: 'FR' });
});
test('store admin and manager with all data can operate other owner while self scope cannot', async ({ page }) => {
  await setup(page, daily);
  await page.addInitScript(() => {
    const u = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    u.roles = ['STORE_MANAGER'];
    localStorage.setItem('zdm-admin-user', JSON.stringify(u));
  });
  await page.goto('/store/customer-management');
  const other = page.locator('tr').filter({ hasText: '王先生2' });
  await expect(other.getByText('编辑', { exact: true })).toBeVisible();
  await expect(other.getByText('归档', { exact: true })).toBeVisible();
  await other.locator('.t-checkbox').click();
  await expect(page.getByRole('button', { name: '批量归档', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('zdm-admin-user')!);
    u.roles = ['STORE_ADMIN'];
    localStorage.setItem('zdm-admin-user', JSON.stringify(u));
  });
  await page.reload();
  await expect(other.getByText('编辑', { exact: true })).toBeVisible();
});

test('legacy raw phone remains unchanged when editing unrelated fields', async ({ page }) => {
  await setup(page, daily);
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/admin/store-customers/1', async (route) => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: ok({ ...customer(1, 7), ...saved }) });
    }
    return route.fulfill({
      json: ok({ customer: { ...customer(1, 7), phone: ' +1 (020) ABC ext 9 ' }, followups: [] }),
    });
  });
  // The list fixture contains the raw historical value, as the real list API does.
  await page.route('**/api/admin/store-customers?status=daily**', async (route) =>
    route.fulfill({ json: ok([{ ...customer(1, 7), phone: ' +1 (020) ABC ext 9 ' }]) }),
  );
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('编辑', { exact: true }).click();
  await expect(page.locator('.zdm-admin-phone-input input').last()).toHaveValue(' +1 (020) ABC ext 9 ');
  await expect(page.locator('.zdm-admin-phone-input input').last()).toBeDisabled();
  await profileField(page, '客户姓名').locator('input').fill('保留历史号码');
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(page.locator('.t-dialog:visible')).toHaveCount(0);
  expect(saved).toMatchObject({ name: '保留历史号码', phone: ' +1 (020) ABC ext 9 ', phoneRegion: '' });
});

test('all data never grants missing edit or archive functions', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  await page.goto('/store/customer-management');
  const other = page.locator('tr').filter({ hasText: '王先生2' });
  await expect(other.getByText('详情', { exact: true })).toBeVisible();
  await expect(other.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(other.getByText('归档', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '批量归档', exact: true })).toHaveCount(0);
});
test('ordinary staff archives another owner customer without transferring ownership', async ({ page }) => {
  const requests = await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生2' }).getByText('归档', { exact: true }).click();
  await page.getByRole('button', { name: '确认归档', exact: true }).click();
  await expect(page.getByText('王先生2', { exact: true })).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ action: 'archive', ids: [2] });
  await page.getByText('归档客户', { exact: true }).click();
  await expect(page.locator('tr').filter({ hasText: '王先生2' })).toContainText('导购B');
});

test('row assignment is removed while details and edit owner remain and archive uses shared wording', async ({
  page,
}) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  const first = page.locator('tr').filter({ hasText: '王先生1' });
  await expect(first.getByText('调整归属', { exact: true })).toHaveCount(0);
  await expect(first.getByText('详情', { exact: true })).toBeVisible();
  await first.getByText('归档', { exact: true }).click();
  let dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.zdm-admin-confirm-dialog__content')).toHaveText('是否归档客户“王先生1”？');
  await expect(dialog.getByRole('button', { name: '确认归档', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await first.locator('.t-checkbox').click();
  await page.locator('tr').filter({ hasText: '王先生2' }).locator('.t-checkbox').click();
  await page.getByRole('button', { name: '批量归档', exact: true }).click();
  dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.zdm-admin-confirm-dialog__content')).toHaveText('是否归档选中的2条客户？');
  await expect(dialog.getByRole('button', { name: '确认批量归档', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '批量调整归属', exact: true })).toBeEnabled();
});

test('restore and purge confirmations name the customer or selected count and retain deletion consequences', async ({
  page,
}) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await page.getByText('归档客户', { exact: true }).click();
  const row = page.locator('tr').filter({ hasText: '王先生3' });
  for (const action of ['取消归档', '彻底删除']) {
    await row.getByText(action, { exact: true }).click();
    const dialog = page.locator('.t-dialog:visible');
    const consequence =
      action === '彻底删除' ? '客户的全部跟进记录及附件将一并删除，删除后无法恢复，已有订单不受影响。' : '';
    await expect(dialog.locator('.zdm-admin-confirm-dialog__content')).toHaveText(
      `是否${action}客户“王先生3”？${consequence}`,
    );
    await expect(dialog.getByRole('button', { name: `确认${action}`, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await row.locator('.t-checkbox').click();
    await page.getByRole('button', { name: `批量${action}`, exact: true }).click();
    await expect(dialog.locator('.zdm-admin-confirm-dialog__content')).toHaveText(
      `是否${action}选中的1条客户？${consequence}`,
    );
    await expect(dialog.getByRole('button', { name: `确认批量${action}`, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await row.locator('.t-checkbox').click();
  }
});

test('both customer tabs display creator and creation time instead of next follow time', async ({ page }) => {
  await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  for (const tab of ['日常客户', '归档客户']) {
    await page.getByText(tab, { exact: true }).click();
    const table = page.locator('.t-table');
    await expect(table.getByRole('columnheader', { name: '创建人', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '创建时间', exact: true })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: '下次跟进时间', exact: true })).toHaveCount(0);
    await expect(table.locator('tbody tr').first()).toContainText('2026-10-13 10:00');
  }
});

test('customer requirement uses 180px native ellipsis and hover reveals full text while creation time fits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 858 });
  await setup(page, [...daily, ...archived]);
  const requirement = '客户希望定制一张可以容纳十人使用的餐桌，需要进口石材台面，并包含送货安装和后续维护服务。';
  await page.route('**/api/admin/store-customers**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/admin/store-customers' && route.request().method() === 'GET')
      return route.fulfill({
        json: ok([
          {
            ...customer(1, 7),
            requirement,
            phone: '123456789012345678901234567890',
            lastFollowedAt: '2026-10-16T19:30:45',
          },
        ]),
      });
    return route.fallback();
  });
  await page.goto('/store/customer-management');
  const row = page.locator('tbody tr').filter({ hasText: '王先生1' });
  const phoneText = row.getByRole('cell').nth(2).locator('.t-table__ellipsis');
  await phoneText.hover();
  const phonePopup = page.locator('.t-popup__content:visible').filter({ hasText: '123456789012345678901234567890' });
  await expect(phonePopup).toBeVisible();
  const phoneBox = (await phoneText.boundingBox())!;
  expect((await phonePopup.boundingBox())!.y).toBeGreaterThanOrEqual(phoneBox.y + phoneBox.height);
  const cell = row.getByRole('cell').nth(4);
  await expect(cell).toHaveText(requirement);
  expect((await cell.boundingBox())!.width).toBeCloseTo(180, 0);
  const text = cell.locator('.t-table__ellipsis');
  await expect(text).toHaveCSS('text-overflow', 'ellipsis');
  await text.hover();
  await expect(page.locator('.t-popup__content:visible').filter({ hasText: requirement })).toBeVisible();
  const popupBox = (await page.locator('.t-popup__content:visible').filter({ hasText: requirement }).boundingBox())!;
  const textBox = (await text.boundingBox())!;
  expect(popupBox.y).toBeGreaterThanOrEqual(textBox.y + textBox.height);
  const date = row.getByRole('cell').nth(7);
  await date.scrollIntoViewIfNeeded();
  const fits = await date
    .locator('.t-table__ellipsis')
    .evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  await expect(date).toHaveText('2026-10-13 10:00');
  await expect(row.getByRole('cell').nth(5)).toHaveText('2026-10-16 19:30');
  expect(
    await row
      .getByRole('cell')
      .nth(5)
      .locator('.t-table__ellipsis')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
});

test('list followup is independent from details and appears immediately after it', async ({ page }) => {
  await setup(page, daily);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生1' });
  await expect(row.locator('td').last().locator('.t-link')).toHaveText(['详情', '跟进', '编辑', '归档']);
  await row.getByText('详情', { exact: true }).click();
  const drawer = page.locator('.t-drawer__content-wrapper:visible');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('跟进', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await row.getByText('跟进', { exact: true }).click();
  await expect(page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' })).toBeVisible();
});

test('detail permission alone does not grant list followup', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生1' });
  await expect(row.getByText('详情', { exact: true })).toBeVisible();
  await expect(row.getByText('跟进', { exact: true })).toHaveCount(0);
});

test('followup permission works without loading customer details', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生1' });
  await expect(row.getByText('详情', { exact: true })).toHaveCount(0);
  await row.getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog.locator('textarea').first().fill('列表直接跟进');
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.some((entry) => entry.content === '列表直接跟进')).toBe(true);
});

test('followups use the native timeline in followed-time descending order with stable ties', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  const records = [
    { id: 100, followedAt: '2026-10-20T10:00:00', content: '中间记录' },
    { id: 999, followedAt: '2026-10-18T10:00:00', content: '最早记录' },
    { id: 2, followedAt: '2026-10-21T10:00:00', content: '最新低编号' },
    { id: 3, followedAt: '2026-10-21T10:00:00', content: '最新高编号' },
  ].map((item) => ({ ...item, createdByAccountId: 7, createdByName: '导购A', attachments: [] }));
  await page.route('**/api/admin/store-customers/1', (route) =>
    route.fulfill({ json: ok({ customer: customer(1, 7), followups: records }) }),
  );
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const drawer = page.locator('.t-drawer__content-wrapper:visible');
  const items = drawer.locator('.t-timeline-item');
  await expect(items).toHaveText([/最新高编号/, /最新低编号/, /中间记录/, /最早记录/]);
  await expect(items.locator('.t-timeline-item__label > div:first-child')).toHaveText([
    '2026-10-21',
    '2026-10-21',
    '2026-10-20',
    '2026-10-18',
  ]);
  await expect(items.locator('.t-timeline-item__label > div:last-child')).toHaveText([
    '10:00:00',
    '10:00:00',
    '10:00:00',
    '10:00:00',
  ]);
  const positions = await items.first().evaluate((item) => {
    const label = item.querySelector('.t-timeline-item__label')!.getBoundingClientRect();
    const dot = item.querySelector('.t-timeline-item__wrapper')!.getBoundingClientRect();
    const content = item.querySelector('.t-timeline-item__content')!.getBoundingClientRect();
    return { labelRight: label.right, dotLeft: dot.left, dotRight: dot.right, contentRight: content.right };
  });
  expect(positions.labelRight).toBeLessThanOrEqual(positions.dotLeft);
  expect(positions.dotRight).toBeLessThan(positions.contentRight);
  const header = items.first().locator('.t-timeline-item__content > .t-row').first();
  await expect(header.getByText('导购A', { exact: true })).toBeVisible();
  await expect(header.getByText('编辑', { exact: true })).toBeVisible();
  await expect(header.getByText('删除', { exact: true })).toBeVisible();
  await expect(header.locator('.t-avatar')).toHaveText('导');
  await expect(drawer).toHaveCSS('width', '1100px');
  const alignment = await header.evaluate((el) => {
    const row = el.getBoundingClientRect();
    const name = el.querySelector('.t-typography')!.getBoundingClientRect();
    const actions = el.querySelector(':scope > .t-space:last-child')!.getBoundingClientRect();
    const content = el.closest('.t-timeline-item__content')!.getBoundingClientRect();
    return {
      nameTop: name.top,
      actionsTop: actions.top,
      rowRight: row.right,
      contentRight: content.right,
      actionsRight: actions.right,
    };
  });
  expect(Math.abs(alignment.nameTop - alignment.actionsTop)).toBeLessThanOrEqual(2);
  expect(Math.abs(alignment.rowRight - alignment.contentRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(alignment.actionsRight - alignment.rowRight)).toBeLessThanOrEqual(1);
  await expect(drawer.getByRole('heading', { name: '跟进记录', exact: true })).toBeVisible();

  const reference = await page.context().newPage();
  await reference.goto('/tests/fixtures/official-ui/reference.html');
  const style = (locator: ReturnType<Page['locator']>) =>
    locator.first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { font: s.font, color: s.color, border: s.border, background: s.backgroundColor, padding: s.padding };
    });
  for (const part of ['dot', 'label']) {
    expect(await style(items.locator(`.t-timeline-item__${part}`))).toEqual(
      await style(reference.locator(`.native-timeline .t-timeline-item__${part}`)),
    );
  }
  await reference.close();
});

test('customer detail reproduces the exported Scheme One geometry and native visual styles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1150 });
  await setup(page, ['daily.view', 'daily.detail']);
  const profile = {
    ...customer(1, 7),
    name: '赵女士',
    nationality: 'CN',
    phoneRegion: 'CN',
    phone: '159****8941',
    callingCode: '+86',
    wechat: 'zhao_8941',
    ownerName: '赵云',
    requirement: '想选一套浅色系餐桌，偏好简洁款式。',
    remark: '—',
    createdByName: '赵云',
    createdAt: '2026-10-19T09:13:38',
  };
  const followups = [
    {
      id: 3,
      followedAt: '2026-10-19T15:20:00',
      content: '已确认餐桌尺寸为180×90厘米，客户偏好浅灰色岩板。',
      nextFollowAt: '2026-10-21T14:00',
      nextFollowTask: '提交选材方案',
      attachments: [],
    },
    {
      id: 2,
      followedAt: '2026-10-19T10:30:00',
      content: '已发送两款餐桌参考图，客户倾向简洁细腿款式。',
      attachments: [{ mediaId: 42, name: '餐桌参考图.jpg', mediaType: 'image' }],
    },
    {
      id: 1,
      followedAt: '2026-10-18T07:54:40',
      content: '客户第一次进店，初步了解客户需求。',
      nextFollowAt: '2026-10-20T08:00',
      nextFollowTask: '进一步确认尺寸与预算',
      attachments: [],
    },
  ].map((record) => ({ ...record, createdByName: '赵云', createdByAccountId: 7 }));
  await page.route('**/api/admin/store-customers/1', (route) =>
    route.fulfill({ json: ok({ customer: profile, followups }) }),
  );
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const drawer = page.locator('.t-drawer__content-wrapper:visible');
  await expect(drawer.locator('.t-avatar')).toHaveCount(3);
  const reference = await page.context().newPage();
  await reference.setViewportSize({ width: 1440, height: 1150 });
  await reference.goto('/tests/fixtures/official-ui/scheme-one.html');
  const native = reference.locator('.t-drawer__content-wrapper:visible');
  await expect(native.locator('.t-avatar')).toHaveCount(3);
  expect((await drawer.locator('.t-timeline').innerText()).replace(/\s+/g, ' ').trim()).toBe(
    (await native.locator('.t-timeline').innerText()).replace(/\s+/g, ' ').trim(),
  );
  const measure = (root: ReturnType<Page['locator']>, selector: string) =>
    root
      .locator(selector)
      .first()
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const parent = el.closest('.t-drawer__content-wrapper')!.getBoundingClientRect();
        const css = getComputedStyle(el);
        return {
          x: rect.x - parent.x,
          y: rect.y - parent.y,
          width: rect.width,
          height: rect.height,
          font: css.font,
          color: css.color,
          background: css.backgroundColor,
          padding: css.padding,
          border: css.border,
        };
      });
  for (const selector of [
    '.t-descriptions',
    'h5.t-typography',
    '.t-timeline',
    '.t-timeline-item__label',
    '.t-timeline-item__dot',
    '.t-timeline-item__content > .t-row',
    '.t-avatar',
    '.t-timeline-item__content p',
  ]) {
    const actual = await measure(drawer, selector);
    const expected = await measure(native, selector);
    expect({ ...actual, x: 0, y: 0, width: 0, height: 0 }).toEqual({ ...expected, x: 0, y: 0, width: 0, height: 0 });
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(actual[key] - expected[key]), selector + ' ' + key).toBeLessThanOrEqual(1);
  }
  await reference.close();
});
