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
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/store-customers' && response.request().method() === 'GET',
    ),
    page.goto('/store/customer-management'),
  ]);
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
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/store-customers' && response.request().method() === 'GET',
    ),
    page.goto('/store/customer-management'),
  ]);
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
  await expect(page.locator('.zdm-admin-feedback.t-is-success')).toHaveText('修改成功');
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
  const inputs = dialog.locator('.t-upload input[type=file]');
  await expect(inputs).toHaveCount(1);
  await inputs.first().setInputFiles({
    name: 'large.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/附件不能超过5MiB/)).toBeVisible();
  expect(requests.filter((item) => item.upload)).toHaveLength(0);
  await dialog.screenshot({ path: testInfo.outputPath('attachment-rejected-size.png'), animations: 'disabled' });
  await inputs.first().setInputFiles(
    [0, 1, 2].map((index) => ({
      name: `note${index}.bin`,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('note'),
    })),
  );
  for (let index = 0; index < 3; index++)
    await expect(dialog.getByText(`note${index}.bin`, { exact: true })).toBeVisible();
  await expect(dialog.locator('.customer-followup-file-row')).toHaveCount(3);
  await inputs
    .first()
    .setInputFiles({ name: 'fourth.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('fourth') });
  expect(requests.filter((item) => item.upload)).toHaveLength(3);
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
        // Counter placement explicitly reserves bottom padding; all other native edges remain unchanged.
        padding: element.matches('textarea') ? `${s.paddingTop} ${s.paddingRight} ${s.paddingLeft}` : s.padding,
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
  const checkSingleColumnWidth = async (form: ReturnType<Page['locator']>) => {
    await expect(form).toHaveClass(/zdm-admin-single-form/);
    await expect(form).toHaveCSS('width', '480px');
    await expect(form.locator('.t-form__label').first()).toHaveCSS('width', '100px');
    const controls = form.locator('.t-date-picker, .t-textarea');
    await expect(controls).toHaveCount(4);
    for (const control of await controls.all()) {
      const widths = await control.evaluate((el) => ({
        control: el.getBoundingClientRect().width,
        field: el.closest('.t-form__controls-content')!.getBoundingClientRect().width,
      }));
      expect(Math.abs(widths.control - widths.field)).toBeLessThanOrEqual(1);
    }
  };
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
  await checkSingleColumnWidth(dialog);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await own.getByText('详情', { exact: true }).click();
  await detail.getByText('编辑', { exact: true }).click();
  dialog = await checkDialog('编辑跟进', 'followup-edit', true);
  await checkSingleColumnWidth(dialog);
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
  const input = dialog.locator('.t-upload input[type=file]');
  await input.setInputFiles({ name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') });
  await expect(dialog.getByText('first.txt', { exact: true })).toBeVisible();
  await dialog.locator('.customer-followup-file-row').hover();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /^替换附件：/ }).click();
  await (await chooser).setFiles({ name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('second') });
  await expect(dialog.getByText('second.txt', { exact: true })).toBeVisible();
  await expect(dialog.getByText('first.txt', { exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await dialog.getByText('second.txt', { exact: true }).click();
  expect((await download).suggestedFilename()).toBe('second.txt');
  await dialog.getByRole('button', { name: '删除附件：second.txt', exact: true }).click();
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
  await expect(dialog.locator('.customer-followup-file-row')).toHaveCount(1);

  await dialog.screenshot({ path: testInfo.outputPath('attachment-uploaded.png'), animations: 'disabled' });
  await dialog.getByText('preview.png', { exact: true }).click();
  const viewer = page.locator('.t-dialog:visible').filter({ hasText: '图片预览' });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole('img', { name: '附件图片', exact: true })).toBeVisible();
  await expect(viewer.locator('.t-dialog__close')).toBeVisible();
  await viewer.locator('.t-dialog__close').click();
  await expect(viewer).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByText('preview.png', { exact: true }).click();
  await expect(viewer).toBeVisible();
  const mask = page.locator('.t-dialog__ctx').filter({ has: viewer }).locator('.t-dialog__mask');
  await expect(mask).toBeVisible();
  await expect(page.locator('.customer-image-preview-mask')).toHaveCount(0);
  await expect(page.locator('.t-image-viewer')).toHaveCount(0);
  await viewer.getByRole('img', { name: '附件图片', exact: true }).click();
  await expect(viewer).toBeVisible();
  await page
    .locator('.t-dialog__ctx')
    .filter({ has: viewer })
    .locator('.t-dialog__position')
    .click({ position: { x: 5, y: 5 } });
  await expect(viewer).not.toBeVisible();
  await expect(mask).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('preview.png', { exact: true })).toBeVisible();
  await dialog.getByText('preview.png', { exact: true }).click();
  await expect(viewer).toBeVisible();
  await expect(mask).toBeVisible();
  await viewer.locator('.t-dialog__close').click();
  await expect(viewer).not.toBeVisible();
  await expect(mask).not.toBeVisible();
  await dialog.getByText('preview.png', { exact: true }).click();
  await expect(viewer).toBeVisible();
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
  const field = dialog
    .locator('.t-form__item')
    .filter({ has: page.locator('.t-form__label').filter({ hasText: '跟进内容' }) });
  const nextField = dialog.locator('.t-form__item').filter({ has: page.locator('label', { hasText: '下次跟进时间' }) });
  const measureRows = async () => ({
    field: await field.boundingBox(),
    nextField: await nextField.boundingBox(),
  });
  await expect(field.locator('textarea')).toBeVisible();
  await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const beforeError = await measureRows();
  const fieldSpacing = await field.evaluate((element) => {
    const input = element.querySelector('textarea')!.getBoundingClientRect();
    const next = element.nextElementSibling!.getBoundingClientRect();
    const officialMargin = parseFloat(getComputedStyle(element).getPropertyValue('--td-comp-margin-xxl'));
    return { gap: next.top - input.bottom, officialMargin };
  });
  expect(fieldSpacing.gap).toBe(fieldSpacing.officialMargin);
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(field.getByText('请输入跟进内容', { exact: true })).toBeVisible();
  await expect(field.locator('.t-form-item-tips')).toHaveCount(0);
  const nativeFeedback = await field.locator('.t-textarea').evaluate((root) => {
    const input = root.querySelector('textarea')!;
    const tips = root.querySelector('.t-textarea__tips')!;
    const count = root.querySelector('.t-textarea__limit')!;
    return {
      counterInside:
        count.getBoundingClientRect().top >= input.getBoundingClientRect().top &&
        count.getBoundingClientRect().bottom < input.getBoundingClientRect().bottom,
      inputGap: tips.getBoundingClientRect().top - input.getBoundingClientRect().bottom,
      counter: count.textContent,
    };
  });
  expect(nativeFeedback.counterInside).toBe(true);
  expect(nativeFeedback.inputGap).toBeGreaterThanOrEqual(0);
  expect(nativeFeedback.inputGap).toBeLessThanOrEqual(1);
  expect(nativeFeedback.counter).toBe('0/100');
  expect(await measureRows()).toEqual(beforeError);
  const errorColor = await field
    .getByText('请输入跟进内容', { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  await expect(field.locator('.t-textarea__inner')).toHaveCSS('border-top-color', errorColor);
  expect(requests.some((item) => item.content)).toBe(false);
  await field.locator('textarea').fill('修正后的跟进内容');
  await expect(field.getByText('请输入跟进内容', { exact: true })).toHaveCount(0);
  expect(await measureRows()).toEqual(beforeError);
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.zdm-admin-feedback.t-is-success')).toHaveText('保存跟进已完成');
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
    '10:00',
    '10:00',
    '10:00',
    '10:00',
  ]);
  const positions = await items.first().evaluate((item) => {
    const label = item.querySelector('.t-timeline-item__label')!.getBoundingClientRect();
    const dot = item.querySelector('.t-timeline-item__wrapper')!.getBoundingClientRect();
    const content = item.querySelector('.t-timeline-item__content')!.getBoundingClientRect();
    return { labelRight: label.right, dotLeft: dot.left, dotRight: dot.right, contentRight: content.right };
  });
  expect(positions.labelRight).toBeLessThanOrEqual(positions.dotLeft);
  expect(positions.dotRight).toBeLessThan(positions.contentRight);
  const header = items.first().locator('.t-timeline-item__content > .t-space > .t-space-item > .t-row').first();
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
      nameCenter: name.top + name.height / 2,
      actionsCenter: actions.top + actions.height / 2,
      rowRight: row.right,
      contentRight: content.right,
      actionsRight: actions.right,
      nameRight: name.right,
    };
  });
  expect(Math.abs(alignment.nameCenter - alignment.actionsCenter)).toBeLessThanOrEqual(2);
  expect(Math.abs(alignment.actionsRight - alignment.contentRight)).toBeLessThanOrEqual(1);
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

test('customer detail follows the approved responsive refinement with native visual styles', async ({ page }) => {
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
  const inlineNext = await drawer.evaluate((element) => {
    const spans = Array.from(element.querySelectorAll('.t-typography span'));
    const time = spans.find((span) => span.textContent === '下次跟进：2026-10-21 14:00')!.getBoundingClientRect();
    const task = spans.find((span) => span.textContent === '提交选材方案')!.getBoundingClientRect();
    return { timeY: time.y, taskY: task.y, timeRight: time.right, taskLeft: task.left };
  });
  expect(inlineNext.timeY).toBe(inlineNext.taskY);
  expect(inlineNext.taskLeft).toBeGreaterThan(inlineNext.timeRight);
  const reference = await page.context().newPage();
  await reference.setViewportSize({ width: 1440, height: 1150 });
  await reference.goto('/tests/fixtures/official-ui/scheme-one.html');
  const native = reference.locator('.t-drawer__content-wrapper:visible');
  await expect(native.locator('.t-avatar')).toHaveCount(3);
  await expect(native.locator('.t-link')).toHaveCount(7);
  await expect(native.locator('.t-link').first()).toBeVisible();
  await expect(native.locator('.t-link').last()).toBeVisible();
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
    '.t-timeline-item__content > .t-space > .t-space-item > .t-row',
    '.t-avatar',
    '.t-timeline-item__content > .t-space > .t-space-item > .t-typography',
  ]) {
    const actual = await measure(drawer, selector);
    const expected = await measure(native, selector);
    expect({ ...actual, x: 0, y: 0, width: 0, height: 0 }).toEqual({ ...expected, x: 0, y: 0, width: 0, height: 0 });
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(actual[key] - expected[key]), selector + ' ' + key).toBeLessThanOrEqual(1);
  }
  const recordTextColors = await drawer
    .locator('.t-timeline .t-typography')
    .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).color));
  expect(new Set(recordTextColors).size).toBe(1);
  await expect(drawer.locator('.t-timeline .t-typography--secondary')).toHaveCount(0);
  await reference.close();
});

for (const width of [1440, 800, 600, 390]) {
  test(`customer detail adapts to ${width}px without overflowing long followup content`, async ({ page }) => {
    await page.setViewportSize({ width, height: 858 });
    await setup(page, ['daily.view', 'daily.detail']);
    await page.route('**/api/admin/store-customers/1', (route) =>
      route.fulfill({
        json: ok({
          customer: { ...customer(1, 7), requirement: '长客户需求'.repeat(20) },
          followups: [
            {
              id: 1,
              followedAt: '2026-10-19T10:00:00',
              createdByName: '赵云',
              createdByAccountId: 7,
              content: '跟进正文需要完整换行展示。'.repeat(25),
              nextFollowAt: '2026-10-20T08:00:00',
              nextFollowTask: '下次跟进事项需要完整展示。'.repeat(15),
              attachments: [{ mediaId: 42, name: '餐桌参考图.jpg', mediaType: 'image' }],
            },
          ],
        }),
      }),
    );
    await page.goto('/store/customer-management');
    await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
    const drawer = page.locator('.t-drawer__content-wrapper:visible');
    await expect(drawer).toHaveCSS('width', `${Math.min(width, 1100)}px`);
    const body = drawer.locator('.t-drawer__body');
    await expect.poll(() => body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(drawer.locator('.t-timeline-item')).toHaveCount(1);
    await expect(drawer.getByText('编辑', { exact: true })).toBeVisible();
    await expect(drawer.getByText('删除', { exact: true })).toBeVisible();
    const cells = drawer.locator('.t-descriptions__body tr').first().locator('td');
    await expect(cells).toHaveCount((width < 768 ? 1 : width < 992 ? 2 : 3) * 2);
    const item = drawer.locator('.t-timeline-item');
    if (width < 768) {
      await expect(item.locator('.t-timeline-item__label')).toHaveCount(0);
      await expect(item.getByText('2026-10-19 10:00', { exact: true })).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 858 });
    await expect(cells).toHaveCount(6);
    await expect(item.locator('.t-timeline-item__label')).toHaveCount(1);
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(drawer).not.toBeVisible();
  });
}

test('followup actions appear only on the hovered or keyboard-focused record', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  await page.route('**/api/admin/store-customers/1', (route) =>
    route.fulfill({
      json: ok({
        customer: customer(1, 7),
        followups: [1, 2].map((id) => ({
          id,
          followedAt: `2026-10-19T10:0${id}:00`,
          content: `跟进记录${id}`,
          createdByName: '赵云',
          createdByAccountId: 7,
          attachments: [],
        })),
      }),
    }),
  );
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const drawer = page.locator('.t-drawer__content-wrapper:visible');
  const records = drawer.locator('.customer-followup-record');
  const actions = drawer.locator('.customer-followup-actions');
  await drawer.getByRole('heading', { name: '跟进记录' }).hover();
  await expect(actions.nth(0)).toHaveCSS('opacity', '0');
  await expect(actions.nth(1)).toHaveCSS('opacity', '0');
  const before = await records.nth(0).boundingBox();
  await records.nth(0).hover();
  await expect(actions.nth(0)).toHaveCSS('opacity', '1');
  await expect(actions.nth(1)).toHaveCSS('opacity', '0');
  expect(await records.nth(0).boundingBox()).toEqual(before);
  await records.nth(1).hover();
  await expect(actions.nth(0)).toHaveCSS('opacity', '0');
  await expect(actions.nth(1)).toHaveCSS('opacity', '1');
  await drawer.getByRole('heading', { name: '跟进记录' }).hover();
  await actions.nth(0).getByText('编辑', { exact: true }).focus();
  await expect(actions.nth(0)).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.getByText('编辑跟进', { exact: true })).toBeVisible();
});

test('touch devices retain followup actions without requiring hover', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    hasTouch: true,
    isMobile: false,
    viewport: { width: 1024, height: 858 },
  });
  const page = await context.newPage();
  try {
    await setup(page, ['daily.view', 'daily.detail']);
    await page.goto('/store/customer-management');
    await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
    const actions = page.locator('.t-drawer__content-wrapper:visible .customer-followup-actions');
    await expect(actions).toHaveCSS('opacity', '1');
    await actions.getByText('编辑', { exact: true }).tap();
    await expect(page.getByText('编辑跟进', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

for (const field of ['followedAt', 'nextFollowAt'] as const) {
  for (const mode of ['create', 'edit'] as const) {
    test(`followup ${field} uses minute precision in ${mode} and displays historical seconds only to minutes`, async ({
      page,
    }) => {
      const requests = await setup(page, ['daily.view', 'daily.detail', 'daily.followup']);
      if (mode === 'edit') {
        await page.route('**/api/admin/store-customers/1', (route) =>
          route.fulfill({
            json: ok({
              customer: customer(1, 7),
              followups: [
                {
                  id: 11,
                  followedAt: '2026-10-19T10:00:47',
                  content: '历史跟进',
                  createdByAccountId: 7,
                  createdByName: '赵云',
                  attachments: [],
                  nextFollowAt: '2026-10-20T08:05:47',
                  nextFollowTask: '确认需求',
                },
              ],
            }),
          }),
        );
      }
      await page.goto('/store/customer-management');
      const row = page.locator('tr').filter({ hasText: '王先生1' });
      if (mode === 'edit') {
        await row.getByText('详情', { exact: true }).click();
        const drawer = page.locator('.t-drawer__content-wrapper:visible');
        await expect(drawer.getByText('下次跟进：2026-10-20 08:05', { exact: true })).toBeVisible();
        await drawer.getByText('编辑', { exact: true }).click();
      } else {
        await row.getByText('跟进', { exact: true }).click();
      }
      const dialog = page.locator('.t-dialog:visible').filter({ hasText: mode === 'edit' ? '编辑跟进' : '新增跟进' });
      const next = dialog
        .locator('.t-form__item')
        .filter({ has: page.locator('label', { hasText: field === 'followedAt' ? /^跟进时间/ : '下次跟进时间' }) });
      const input = next.locator('input');
      if (mode === 'edit')
        await expect(input).toHaveValue(field === 'followedAt' ? '2026-10-19 10:00' : '2026-10-20 08:05');
      else if (field === 'followedAt') await expect(input).toHaveValue(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
      await input.click();
      const panel = page.locator('.t-date-picker__panel:visible');
      const columns = panel.locator('.t-time-picker__panel-body-scroll');
      await expect(columns).toHaveCount(2);
      // Native time columns scroll smoothly and debounce changes by 50ms.
      // Wait for their actual scroll positions to settle before the next action.
      const settleTimeColumns = () =>
        columns.evaluateAll(
          (elements) =>
            new Promise<void>((resolve) => {
              let positions = elements.map((el) => el.scrollTop).join(',');
              let unchangedSince = performance.now();
              const frame = () => {
                const current = elements.map((el) => el.scrollTop).join(',');
                if (current !== positions) {
                  positions = current;
                  unchangedSince = performance.now();
                }
                if (performance.now() - unchangedSince >= 150) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            }),
        );
      await settleTimeColumns();
      if (mode === 'create') {
        await panel.locator('.t-date-picker__cell').filter({ hasText: /^15$/ }).first().click();
      }
      await columns.nth(0).getByText('08', { exact: true }).click();
      await settleTimeColumns();
      await expect(panel.locator('.t-date-picker__panel-time-viewer')).toContainText('08:');
      await columns.nth(1).getByText('05', { exact: true }).click();
      await settleTimeColumns();
      await expect(panel.locator('.t-date-picker__panel-time-viewer')).toContainText('08:05');
      await panel.getByRole('button', { name: '确定', exact: true }).click();
      await expect(input).toHaveValue(/^\d{4}-\d{2}-\d{2} 08:05$/);
      await dialog.locator('textarea').first().fill('分钟精度跟进');
      await dialog.getByRole('button', { name: mode === 'edit' ? '确认保存' : '确认新增', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      expect(requests.at(-1)?.[field]).toMatch(/^\d{4}-\d{2}-\d{2}T08:05:00$/);
      expect(requests.at(-1)?.followedAt).toMatch(/:\d{2}$/);
    });
  }
}

test('customer text links use native color-only hover without underlines', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail', 'daily.followup', 'daily.edit', 'daily.archive']);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生1' });
  const links = row.locator('.t-link');
  await expect(links).toHaveCount(5);
  for (const link of await links.all()) {
    await expect(link).toHaveClass(/t-link--hover-color/);
    await expect(link).not.toHaveClass(/t-link--hover-underline/);
    await page.getByRole('button', { name: '查询', exact: true }).hover();
    const before = await link.evaluate((el) => getComputedStyle(el).color);
    await link.hover();
    await expect(link).not.toHaveCSS('color', before);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    expect(await link.evaluate((el) => getComputedStyle(el, '::after').borderBottomWidth)).toBe('0px');
  }
  await row.getByText('详情', { exact: true }).click();
  const drawer = page.locator('.t-drawer__content-wrapper:visible');
  await drawer.locator('.customer-followup-record').hover();
  for (const link of await drawer.locator('.customer-followup-actions .t-link').all()) {
    await link.hover();
    await expect(link).toHaveClass(/t-link--hover-color/);
    await expect(link).toHaveCSS('text-decoration-line', 'none');
    expect(await link.evaluate((el) => getComputedStyle(el, '::after').borderBottomWidth)).toBe('0px');
  }
});

for (const mode of ['create', 'edit'] as const) {
  test(`followup text inputs cap both fields at 100 characters in ${mode}`, async ({ page }) => {
    const requests = await setup(page, ['daily.view', 'daily.detail', 'daily.followup']);
    await page.goto('/store/customer-management');
    const row = page.locator('tr').filter({ hasText: '王先生1' });
    if (mode === 'create') await row.getByText('跟进', { exact: true }).click();
    else {
      await row.getByText('详情', { exact: true }).click();
      await page.locator('.t-drawer__content-wrapper:visible').getByText('编辑', { exact: true }).click();
    }
    const dialog = page.locator('.t-dialog:visible').filter({ hasText: mode === 'create' ? '新增跟进' : '编辑跟进' });
    const fields = dialog.locator('textarea');
    await expect(fields).toHaveCount(2);
    for (const field of await fields.all()) {
      await expect(field).toHaveAttribute('maxlength', '100');
      await field.fill('字'.repeat(101));
      await expect(field).toHaveValue('字'.repeat(100));
    }
    await dialog.getByRole('button', { name: mode === 'create' ? '确认新增' : '确认保存', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(requests.at(-1)?.content).toHaveLength(100);
    expect(requests.at(-1)?.nextFollowTask).toHaveLength(100);
  });
}

test('batch attachments keep distinct slots for duplicate names and release unsaved files on cancel', async ({
  page,
}) => {
  await setup(page, ['daily.view', 'daily.followup']);
  const released: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && /\/store-customers\/1\/attachments\/\d+$/.test(request.url()))
      released.push(request.url());
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog
    .locator('.t-upload input[type=file]')
    .setInputFiles(
      [1, 2, 3].map((index) => ({ name: '同名.txt', mimeType: 'text/plain', buffer: Buffer.from(String(index)) })),
    );
  await expect(dialog.locator('.t-upload__single-name.t-link')).toHaveCount(3);
  const trigger = dialog.locator('.t-upload__trigger button');
  await expect(trigger).toBeDisabled();
  const firstRow = dialog.locator('.customer-followup-file-row').first();
  await firstRow.hover();
  const chooser = page.waitForEvent('filechooser');
  await firstRow.getByRole('button', { name: /^替换附件：/ }).click();
  await (await chooser).setFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('new') });
  await expect(dialog.locator('.t-upload__single-name.t-link')).toHaveCount(3);
  await expect(dialog.getByText('replacement.txt', { exact: true })).toBeVisible();
  await expect(trigger).toBeDisabled();
  await firstRow.hover();
  await firstRow.getByRole('button', { name: /^删除附件：/ }).click();
  await expect(dialog.locator('.customer-followup-file-row')).toHaveCount(2);
  await expect(trigger).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => released.length).toBe(4);
  expect(new Set(released).size).toBe(4);
});

test('replacement failure keeps the existing attachment and saving releases only replaced temporary media', async ({
  page,
}) => {
  const requests = await setup(page, ['daily.view', 'daily.followup']);
  const released: number[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && /\/store-customers\/1\/attachments\/\d+$/.test(request.url()))
      released.push(Number(request.url().split('/').at(-1)));
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog
    .locator('.t-upload input[type=file]')
    .setInputFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('old') });
  await expect(dialog.getByText('old.txt', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: '已上传“old.txt”' })).toBeVisible();
  const failedRoute = '**/api/admin/store-customers/1/attachments';
  await page.route(failedRoute, (route) => route.fulfill({ status: 500, json: { message: '上传失败' } }));
  await dialog.locator('.customer-followup-file-row').hover();
  let chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /^替换附件：/ }).click();
  await (await chooser).setFiles({ name: 'failed.txt', mimeType: 'text/plain', buffer: Buffer.from('failed') });
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: '上传“failed.txt”失败：上传失败' })).toBeVisible();
  await expect(dialog.getByText('old.txt', { exact: true })).toBeVisible();
  await page.unroute(failedRoute);
  chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /^替换附件：/ }).click();
  await (await chooser).setFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('new') });
  await expect(dialog.getByText('new.txt', { exact: true })).toBeVisible();
  await expect(page.locator('.zdm-admin-feedback').filter({ hasText: '已上传“new.txt”' })).toBeVisible();
  await expect(dialog.getByText('old.txt', { exact: true })).toHaveCount(0);
  await dialog.locator('textarea').first().fill('保留新附件');
  await dialog.getByRole('button', { name: '确认新增', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests.at(-1)?.mediaIds).toEqual([102]);
  await expect.poll(() => released).toEqual([101]);
});

test('existing private attachments still preview through the authorized customer endpoint', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.detail']);
  await page.route('**/api/admin/store-customers/1', (route) =>
    route.fulfill({
      json: ok({
        customer: customer(1, 7),
        followups: [
          {
            id: 11,
            followedAt: '2026-10-19T11:04:00',
            content: '已有附件',
            createdByAccountId: 7,
            createdByName: '赵云',
            attachments: [{ mediaId: 44, name: '历史.txt', mediaType: 'file' }],
          },
        ],
      }),
    }),
  );
  let authorization = '';
  await page.route('**/api/admin/store-customers/1/followups/11/attachments/44', (route) => {
    authorization = route.request().headers().authorization;
    return route.fulfill({ contentType: 'text/plain', body: 'private attachment' });
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  await page.locator('.t-drawer__content-wrapper:visible').getByText('编辑', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '编辑跟进' });
  const download = page.waitForEvent('download');
  await dialog.getByText('历史.txt', { exact: true }).click();
  expect((await download).suggestedFilename()).toBe('历史.txt');
  expect(authorization).toBe('Bearer dev-token');
});

test('scheme two preserves native upload geometry and reveals replacement only for its file row', async ({ page }) => {
  await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog
    .locator('.t-upload input[type=file]')
    .setInputFiles(
      ['first.txt', 'second.txt'].map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })),
    );
  await expect(dialog.locator('.customer-followup-file-row')).toHaveCount(2);
  await expect(dialog.locator('.t-upload__single-name.t-link')).toHaveCount(2);
  await dialog.locator('label').filter({ hasText: /^附件/ }).hover();
  const actions = dialog.locator('.customer-followup-file-actions');
  await expect(dialog.getByRole('button', { name: /^删除附件：/ })).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /^替换附件：/ })).toHaveCount(2);
  await expect(dialog.getByText('替换', { exact: true })).toHaveCount(0);
  await expect(actions.nth(0)).toHaveCSS('opacity', '0');
  await expect(actions.nth(1)).toHaveCSS('opacity', '0');
  const reference = await page.context().newPage();
  await reference.goto('/tests/fixtures/official-ui/attachment-scheme-two.html');
  await expect(reference.locator('.t-upload__single-name')).toHaveCount(2);
  await reference.locator('label').hover();
  const actual = dialog.locator('.t-upload');
  const native = reference.locator('.t-upload');
  const measure = (root: ReturnType<Page['locator']>, selector: string) =>
    root.locator(selector).evaluateAll((els) =>
      els.map((el) => {
        const rect = el.getBoundingClientRect();
        const parent = el.closest('.t-upload')!.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          x: rect.x - parent.x,
          y: rect.y - parent.y,
          width: rect.width,
          height: rect.height,
          font: style.font,
          color: style.color,
          padding: style.padding,
          border: style.border,
        };
      }),
    );
  for (const selector of [
    '.t-upload__trigger .t-button',
    '.t-upload__single-name',
    '.t-upload__icon-delete:not(.customer-followup-file-replace)',
    '.t-upload__tips',
  ]) {
    const a = await measure(actual, selector);
    const b = await measure(native, selector);
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect({ ...a[i], x: 0, y: 0, width: 0, height: 0 }).toEqual({ ...b[i], x: 0, y: 0, width: 0, height: 0 });
      // Two actions use native Space alignment; compare size here and their centered layout below.
      const keys = selector.includes('icon-delete')
        ? (['width', 'height'] as const)
        : (['x', 'y', 'width', 'height'] as const);
      for (const key of keys) expect(Math.abs(a[i][key] - b[i][key]), selector + ' ' + key).toBeLessThanOrEqual(1);
    }
  }
  await reference.close();
  const actionAlignment = await actions.first().evaluate((el) => {
    const row = el.closest('.customer-followup-file-row')!.getBoundingClientRect();
    const group = el.getBoundingClientRect();
    return {
      rowCenter: row.top + row.height / 2,
      groupCenter: group.top + group.height / 2,
      itemCenters: Array.from(el.children).map((item) => {
        const rect = item.getBoundingClientRect();
        return rect.top + rect.height / 2;
      }),
    };
  });
  expect(Math.abs(actionAlignment.groupCenter - actionAlignment.rowCenter)).toBeLessThanOrEqual(1);
  for (const center of actionAlignment.itemCenters)
    expect(Math.abs(center - actionAlignment.groupCenter)).toBeLessThanOrEqual(1);
  const iconGeometry = await actions
    .first()
    .locator('[role="button"]')
    .evaluateAll((icons) =>
      icons.map((icon) => {
        const svg = icon as SVGGraphicsElement;
        const rect = svg.getBoundingClientRect();
        const glyph = svg.getBBox();
        return {
          label: icon.getAttribute('aria-label'),
          x: rect.x,
          width: rect.width,
          glyphWidth: (glyph.width * rect.width) / 24,
          glyphHeight: (glyph.height * rect.height) / 24,
        };
      }),
    );
  expect(iconGeometry[0].label).toBe('替换附件：first.txt');
  expect(iconGeometry[1].label).toBe('删除附件：first.txt');
  expect(iconGeometry[0].x).toBeLessThan(iconGeometry[1].x);
  expect(iconGeometry[0].width / iconGeometry[1].width).toBeCloseTo(0.6, 1);
  expect(Math.abs(iconGeometry[0].glyphWidth - iconGeometry[1].glyphWidth)).toBeLessThan(2);
  expect(Math.abs(iconGeometry[0].glyphHeight - iconGeometry[1].glyphHeight)).toBeLessThan(2);
  await dialog.locator('.customer-followup-file-row').nth(0).hover();
  await expect(actions.nth(0)).toHaveCSS('opacity', '1');
  await expect(actions.nth(1)).toHaveCSS('opacity', '0');
  await dialog.locator('label').filter({ hasText: /^附件/ }).hover();
  await expect(actions.nth(0)).toHaveCSS('opacity', '0');
  const replacement = dialog.getByRole('button', { name: '替换附件：first.txt', exact: true });
  await dialog.locator('.customer-followup-file-row').nth(0).hover();
  const pointerChooser = page.waitForEvent('filechooser');
  await replacement.click();
  await pointerChooser;
  await dialog.locator('input[aria-label="替换附件"]').dispatchEvent('cancel');
  await dialog.locator('label').filter({ hasText: /^附件/ }).hover();
  await expect(replacement).not.toBeFocused();
  await expect(actions.nth(0)).toHaveCSS('opacity', '0');
  await expect(dialog.locator('.t-upload__single-name.t-link')).toHaveCount(2);
  await replacement.focus();
  const keyboardChooser = page.waitForEvent('filechooser');
  await replacement.press('Enter');
  await keyboardChooser;
  await dialog.locator('input[aria-label="替换附件"]').dispatchEvent('cancel');
  await expect(replacement).toBeFocused();
  await expect(actions.nth(0)).toHaveCSS('opacity', '1');
  await expect(actions.nth(1)).toHaveCSS('opacity', '0');
});

test('scheme two accepts an attachment exactly at the 5MiB boundary', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.followup']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog.locator('.t-upload input[type=file]').setInputFiles({
    name: 'exact-5MiB.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5 * 1024 * 1024),
  });
  await expect(dialog.locator('.t-upload__single-name.t-link')).toHaveText('exact-5MiB.bin');
  await expect.poll(() => requests.filter((item) => item.upload).length).toBe(1);
});

test('canceling an in-flight attachment releases its media and never fills another customer dialog', async ({
  page,
}) => {
  await setup(page, ['daily.view', 'daily.followup']);
  let completeUpload!: () => void;
  const gate = new Promise<void>((resolve) => {
    completeUpload = resolve;
  });
  let started = false;
  const released: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && request.url().endsWith('/store-customers/1/attachments/501'))
      released.push(request.url());
  });
  await page.route('**/api/admin/store-customers/1/attachments', async (route) => {
    started = true;
    await gate;
    await route.fulfill({ json: ok({ id: 501, mediaType: 'file', mimeType: 'text/plain' }) });
  });
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('跟进', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await dialog
    .locator('.t-upload input[type=file]')
    .setInputFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('late') });
  await expect.poll(() => started).toBe(true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  completeUpload();
  await expect.poll(() => released.length).toBe(1);
  await page.locator('tr').filter({ hasText: '王先生2' }).getByText('跟进', { exact: true }).click();
  const next = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  await expect(next.locator('.customer-followup-file-row')).toHaveCount(0);
  await expect(next.getByText('late.txt', { exact: true })).toHaveCount(0);
});
