import { expect, test, type Page } from '@playwright/test';
import { installAdminApiMocks } from './admin-api-mocks';
const prefix = 'store.customer-management';
const ok = (data: unknown) => ({ code: 0, message: 'ok', data });
const customer = (id: number, ownerAccountId: number, status = 'daily') => ({
  id,
  tenantId: 1,
  storeId: 2,
  name: `王先生${id}`,
  phone: '',
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
async function setup(page: Page, grants: string[], scope = 'all') {
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
  let records = [customer(1, 7), customer(2, 8), customer(3, 7, 'archived')];
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
    if (path.endsWith('/owners'))
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
        json: ok({ id: 100 + requests.length, mediaType: 'file', mimeType: 'application/octet-stream' }),
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
    if (id) return route.fulfill({ json: ok({ customer: records.find((c) => c.id === id), followups }) });
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.push(body);
      const c = { ...customer(4, 7), ...body };
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
  'daily.edit',
  'daily.assign',
  'daily.archive',
  'daily.batch-assign',
  'daily.batch-archive',
];
const archived = [
  'archived.view',
  'archived.detail',
  'archived.edit',
  'archived.assign',
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
  await expect(page.locator('.filter-fields').getByText('归属人', { exact: true })).toHaveCount(0);
});
test('all data without manager role sees others but cannot edit or archive them', async ({ page }) => {
  await setup(page, daily);
  await page.goto('/store/customer-management');
  const row = page.locator('tr').filter({ hasText: '王先生2' });
  await expect(row).toBeVisible();
  await expect(row.getByText('调整归属', { exact: true })).toBeVisible();
  await expect(row.getByText('编辑', { exact: true })).toHaveCount(0);
  await expect(row.getByText('归档', { exact: true })).toHaveCount(0);
  await row.getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '客户详情' });
  await expect(dialog.getByRole('button', { name: '新增跟进', exact: true })).toHaveCount(0);
});
test('new customer requires only name and never asks for shipping or source', async ({ page }) => {
  const requests = await setup(page, daily);
  await page.goto('/store/customer-management');
  await page.getByRole('button', { name: '新增', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增客户' });
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog.getByText('请输入姓名', { exact: true })).toBeVisible();
  await dialog.locator('.t-form__item').filter({ hasText: '姓名' }).locator('input').fill('李女士');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('李女士', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ name: '李女士', phone: '' });
  expect(requests.at(-1)).not.toHaveProperty('ownerAccountId');
});
test('current owner edits historical followup without a separate followup grant', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.detail']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  const detail = page.locator('.t-dialog:visible').filter({ hasText: '客户详情' });
  await expect(detail.getByRole('button', { name: '新增跟进', exact: true })).toBeVisible();
  await detail.getByText('编辑', { exact: true }).click();
  const edit = page.locator('.t-dialog:visible').filter({ hasText: '编辑跟进' });
  await edit.locator('textarea').first().fill('接手后补充');
  await edit.getByRole('button', { name: '提交', exact: true }).click();
  await expect(detail.getByText('接手后补充', { exact: true })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ content: '接手后补充', mediaIds: [] });
});
test('archive assignment is independent of role and returns the customer to daily', async ({ page }) => {
  const requests = await setup(page, [...daily, ...archived]);
  await page.goto('/store/customer-management');
  await page.getByText('归档客户', { exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生3' }).getByText('调整归属', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '调整归属' });
  await expect(dialog.getByText('调整归属后，客户将自动恢复为日常客户。')).toBeVisible();
  await dialog.locator('.t-select').click();
  await page.locator('.t-select-option').filter({ hasText: '导购B' }).click();
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByText('王先生3', { exact: true })).toHaveCount(0);
  expect(requests.at(-1)).toMatchObject({ action: 'assign', status: 'archived', ownerAccountId: 8 });
  await page.getByText('日常客户', { exact: true }).click();
  await expect(page.getByText('王先生3', { exact: true })).toBeVisible();
});

test('followup accepts at most three attachments and blocks files above 5MiB before upload', async ({ page }) => {
  const requests = await setup(page, ['daily.view', 'daily.detail']);
  await page.goto('/store/customer-management');
  await page.locator('tr').filter({ hasText: '王先生1' }).getByText('详情', { exact: true }).click();
  await page.locator('.t-dialog:visible').getByRole('button', { name: '新增跟进', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible').filter({ hasText: '新增跟进' });
  const inputs = dialog.locator('input[type=file]');
  await expect(inputs).toHaveCount(3);
  await inputs.first().setInputFiles({
    name: 'large.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(/附件不能超过5MiB/)).toBeVisible();
  expect(requests.filter((item) => item.upload)).toHaveLength(0);
  for (let index = 0; index < 3; index++) {
    await inputs
      .nth(index)
      .setInputFiles({ name: `note${index}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.from('note') });
    await expect(dialog.getByText(`note${index}.bin`, { exact: true })).toBeVisible();
  }
  await dialog.locator('textarea').first().fill('三个附件');
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.locator('.t-dialog:visible').getByText('三个附件', { exact: true })).toBeVisible();
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
  await page.locator('.t-dialog:visible').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('tr').filter({ hasText: '王先生2' }).getByText('详情', { exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.getByText('王先生2', { exact: true })).toBeVisible();
  const response = page.waitForResponse('**/api/admin/store-customers/1');
  release();
  await response;
  await expect(dialog.getByText('王先生2', { exact: true })).toBeVisible();
  await expect(dialog.getByText('王先生1', { exact: true })).toHaveCount(0);
});
